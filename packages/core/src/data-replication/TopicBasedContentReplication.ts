import { Queue } from '@datastructures-js/queue';
import { logger } from '@dechat/common';
import { Startable } from '@libp2p/interface';
import { sampleSize } from 'es-toolkit';
import { BroadcastPropagationInterface } from '../data-propagation/broadcast/BroadcastPropagationInterface';
import { PropagationContext } from '../data-propagation/types';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { DataSerializer } from '../shared/types';
import { DeChatComponents, DeChatFactory } from '../types';
import { ContentHashStrategyInterface } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { InflightRequestTracker, inflightRequestTracker } from './replication-protocol/InflightRequestTracker';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash } from './types';

export class TopicBasedContentReplication implements DataReplicationInterface, Startable {
  private inflightTracker: InflightRequestTracker;

  private config: DeChatComponents['config']['strategies']['replication'];

  private selfPeerId: string;

  private getKnownPeers: () => string[];

  private storage: ReplicaStoreInterface;

  private hashStrategy: ContentHashStrategyInterface;

  private serializer: DataSerializer;

  readonly replicationProtocol: ReplicationProtocolInterface;

  private readonly broadcastPropagation: BroadcastPropagationInterface;

  private started = false;

  private readonly boundMessageHandler = (data: unknown, context?: PropagationContext) => {
    this.onLocalDataProduced(data).catch((err) =>
      logger.error(`[TopicBasedContentReplication] Error in message handler: ${(err as Error).message}`),
    );
  };

  constructor(components: DeChatComponents) {
    if (!components.strategies.contentHasher)
      throw new Error('[TopicBasedContentReplication] requires a contentHasher strategy.');
    if (!components.strategies.replicaStore)
      throw new Error('[TopicBasedContentReplication] requires a replicaStore strategy.');
    if (!components.strategies.broadcast)
      throw new Error('[TopicBasedContentReplication] requires a replicaStore strategy.');
    if (!components.strategies.replicationProtocol)
      throw new Error('[TopicBasedContentReplication] requires a replicationProtocol strategy.');

    this.selfPeerId = components.libp2p.peerId.toString();
    this.config = components.config.strategies.replication;
    this.hashStrategy = components.strategies.contentHasher;
    this.storage = components.strategies.replicaStore;
    this.replicationProtocol = components.strategies.replicationProtocol;
    this.broadcastPropagation = components.strategies.broadcast;
    this.getKnownPeers = () => components.peerRegistry.getPeers();
    this.serializer = components.serializer;
    this.inflightTracker = inflightRequestTracker();
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.replicationProtocol.setDelegate(this);
    logger.info('[TopicBasedContentReplication] TopicBasedContentHashReplication started');
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    logger.info('[TopicBasedContentReplication] TopicBasedContentHashReplication stopped');
  }

  /**
   * Dynamically subscribes to a chat topic to start replicating its messages.
   * @param topic The pubsub topic string
   */
  public async joinTopic(topic: string): Promise<void> {
    await this.broadcastPropagation.subscribe(topic, this.boundMessageHandler);
    logger.debug(`[TopicBasedContentReplication] Subscribed to topic: ${topic}`);
  }

  /**
   * Unsubscribes from a chat topic to stop replicating its messages.
   * @param topic The pubsub topic string
   */
  public async leaveTopic(topic: string): Promise<void> {
    await this.broadcastPropagation.unsubscribe(topic, this.boundMessageHandler);
    logger.debug(`[TopicBasedContentReplication] Unsubscribed from topic: ${topic}`);
  }

  /**
   * * @param hash - The deterministic content hash of the data.
   * @param _fromPeer - The peer ID of the sender (optional/unused in distance logic).
   * @returns {boolean} Always true we want to replicate all messages
   */
  public readonly shouldReplicate = (hash: ContentHash, _fromPeer?: string): boolean => {
    return true;
  };

  public readonly onLocalDataProduced = async <T>(data: T): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;

    await this.persist(hash, data);
    await this.replicationProtocol.announceToNetwork(hash);
  };

  public readonly onRemoteDataReceived = async <T>(data: T, fromPeer: string): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;
    if (!this.shouldReplicate(hash, fromPeer)) return;

    await this.persist(hash, data);
    await this.replicationProtocol.announceToNetwork(hash);
  };

  public readonly evict = async (hash: ContentHash): Promise<void> => {
    // Not supported for topic-based replication
  };

  private readonly persist = async <T>(hash: ContentHash, data: T): Promise<void> => {
    if (await this.storage.has(hash)) return;

    const bytes = this.serializer.serialize(data);
    await this.storage.put(hash, bytes);
  };

  async onPeerAnnounced(hash: string, peerId: string, handleAnnounce: () => Promise<void>): Promise<void> {
    if (await this.storage.has(hash)) return;
    if (this.inflightTracker.isInflight(hash)) return;
    if (!this.shouldReplicate(hash)) return;

    this.inflightTracker.acquire(hash);
    await this.executeWithRetry(async () => {
      return handleAnnounce();
    })
      .catch((error) => logger.error('[TopicBasedContentReplication] Replication request retry failed:', error))
      .finally(() => this.inflightTracker.release(hash));
  }

  async onPeerRequested(
    hash: string,
    fromPeerId: string,
  ): Promise<{ found: true; data: Uint8Array } | { found: false; closestPeers: string[] }> {
    const data = await this.storage.get(hash);
    if (data) {
      return { found: true, data };
    }
    const closestPeers = sampleSize(this.getKnownPeers(), 4).filter((peerId) => peerId !== fromPeerId);
    return { found: false, closestPeers };
  }

  async onPeerDeliveredContent(hash: string, data: Uint8Array, peerId: string): Promise<void> {
    if (await this.storage.has(hash)) return;
    if (!this.shouldReplicate(hash)) return;
    if (this.inflightTracker.isInflight(hash)) {
      this.inflightTracker.release(hash);
    }
    await this.storage.put(hash, data);
  }

  async onPeerReportedError(
    hash: string,
    reason: string,
    closestPeers: string[] | undefined,
    peerId: string,
  ): Promise<void> {
    if (this.inflightTracker.isInflight(hash)) {
      this.inflightTracker.release(hash);
    }
    logger.debug(`[TopicBasedContentReplication] Passive replication error from ${peerId}`, { hash, reason });
  }

  /**
   * Explicitly requests a missing data payload from a specific peer. If not found in targetPeerId, it fetches from other peers for a max peer hops of 3
   * Triggered exclusively by the Anti-Entropy Sync Manager.
   */
  public async requestMissingData<T>(hash: ContentHash, targetPeerId?: string): Promise<T | null> {
    if (await this.storage.has(hash)) {
      const rawBytes = await this.storage.get(hash);
      if (rawBytes) return this.serializer.deserialize<T>(rawBytes);
      return null;
    }

    const visitedPeers = new Set<string>([this.selfPeerId]);
    const queue = new Queue<string>();

    // Enqueue the targetPeerId if passed, this should be at the first in the queue, as it is highly probable that this peer has the data
    if (targetPeerId) queue.push(targetPeerId);

    let attempts = 0;
    const MAX_HOPS = 3;

    while (!queue.isEmpty() && attempts < MAX_HOPS) {
      const peerId = queue.dequeue();
      if (!peerId || visitedPeers.has(peerId)) continue;

      visitedPeers.add(peerId);
      attempts++;

      try {
        const response = await this.replicationProtocol.requestDataAndAwaitResponse(hash, peerId);

        if (response.type === 'replication_content') {
          const rawBytes = response.replicationContent;
          await this.storage.put(hash, rawBytes);
          logger.info(`[TopicBasedContentReplication] Successfully retrieved missing data ${hash}.`);
          return this.serializer.deserialize<T>(rawBytes);
        }

        if (response.type === 'replication_error' && response.closestPeers) {
          for (const newPeerId of response.closestPeers) {
            if (!visitedPeers.has(newPeerId)) queue.enqueue(newPeerId);
          }
        }
      } catch (error) {
        logger.warn(`[TopicBasedContentReplication] Failed to fetch ${hash} from peer ${peerId}`, error);
      }
    }

    logger.warn(
      `[TopicBasedContentReplication] Iterative lookup exhausted for ${hash}. Data not found after ${attempts} hops.`,
    );
    return null;
  }

  private readonly executeWithRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        logger.error(
          `[TopicBasedContentReplication] Failed attempt ${attempt + 1} for replication request, retrying...`,
        );
        attempt++;
        if (attempt >= this.config.maxAttempts) {
          throw error;
        }
        const delay = this.config.baseDelayMs * 2 ** (attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  };
}

export const topicBasedContentHashReplication = (): DeChatFactory<TopicBasedContentReplication> => {
  return (components: DeChatComponents) => new TopicBasedContentReplication(components);
};
