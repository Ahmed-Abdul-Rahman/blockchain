import { PriorityQueue } from '@datastructures-js/priority-queue';
import { logger } from '@dechat/common';
import { calculateXorDistance, toHashBigInt } from '@dechat/crypto';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { DataSerializer } from '../shared/types';
import { DeChatComponents, DeChatFactory } from '../types';
import { ContentHashStrategyInterface } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { InflightRequestTracker, inflightRequestTracker } from './replication-protocol/InflightRequestTracker';
import { ReplicationEngineDelegate } from './replication-protocol/ReplicationEngineDelegateInterface';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash } from './types';

interface PeerDistance {
  peerId: string;
  distance: bigint;
}

export class KReplicaContentReplication implements DataReplicationInterface, ReplicationEngineDelegate {
  private inflightTracker: InflightRequestTracker;

  private config: DeChatComponents['config']['strategies']['replication'];

  private selfPeerId: string;

  private getKnownPeers: () => string[];

  private storage: ReplicaStoreInterface;

  private hashStrategy: ContentHashStrategyInterface;

  private serializer: DataSerializer;

  /** Reference to components for runtime access to antiEntropyMetrics (set after manager init) */
  private readonly components: Pick<DeChatComponents, 'antiEntropyMetrics'>;

  readonly replicationProtocol: ReplicationProtocolInterface;

  public constructor(components: DeChatComponents) {
    if (!components.strategies.contentHasher)
      throw new Error('KReplicaContentReplication requires a contentHasher strategy.');
    if (!components.strategies.replicaStore)
      throw new Error('KReplicaContentReplication requires a replicaStore strategy.');
    if (!components.strategies.replicationProtocol)
      throw new Error('KReplicaContentReplication requires a replicationProtocol strategy.');

    this.selfPeerId = components.libp2p.peerId.toString();
    this.config = components.config.strategies.replication;
    this.serializer = components.serializer;
    this.getKnownPeers = () => components.peerRegistry.getPeers();
    this.hashStrategy = components.strategies.contentHasher;
    this.storage = components.strategies.replicaStore;
    this.replicationProtocol = components.strategies.replicationProtocol;
    this.inflightTracker = inflightRequestTracker();
    this.components = components;
  }

  public readonly start = async (): Promise<void> => {
    this.replicationProtocol.setDelegate(this);
  };

  public readonly stop = async (): Promise<void> => {};

  /**
   * Decides if this node should persist the data based on the Kademlia XOR distance metric.
   * Highly optimized: Exits early O(N) as soon as it finds K peers that are closer to the data.
   * * @param hash - The deterministic content hash of the data.
   * @param _fromPeer - The peer ID of the sender (optional/unused in distance logic).
   * @returns {boolean} True if the local node is mathematically among the top K closest peers.
   */
  public readonly shouldReplicate = (hash: ContentHash, _fromPeer?: string): boolean => {
    const knownPeers = this.getKnownPeers();
    const totalNetworkView = knownPeers.length + 1;
    // If the network size is smaller than our target replica count, everyone replicates
    const target = Math.min(this.config.kReplicaCount, 3);
    if (totalNetworkView <= target) return true;

    const contentBigInt = toHashBigInt(hash);
    const selfBigInt = toHashBigInt(this.selfPeerId);
    const selfDistance = calculateXorDistance(selfBigInt, contentBigInt);

    let closestPeersCount = 0;

    for (const peerId of knownPeers) {
      const peerBigInt = toHashBigInt(peerId);
      const peerDistance = calculateXorDistance(peerBigInt, contentBigInt);
      if (peerDistance < selfDistance) closestPeersCount++;
      if (closestPeersCount >= this.config.kReplicaCount) return false;
    }
    return true;
  };

  public readonly onLocalDataProduced = async <T>(data: T): Promise<void> => {
    this.components.antiEntropyMetrics?.getActivityTracker().recordLocalProduce();

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
    // await this.storage.delete(hash);
    // Not supported for K-replica replication
  };

  private readonly persist = async <T>(hash: ContentHash, data: T): Promise<void> => {
    if (await this.storage.has(hash)) return;

    const bytes = this.serializer.serialize(data);
    await this.storage.put(hash, bytes);
  };

  /**
   * Performs an iterative Kademlia-style network lookup to fetch missing data.
   * Uses a Priority Queue to efficiently traverse the network toward the target hash.
   * @param hash - The content hash of the missing data
   */
  public async requestMissingData<T>(hash: ContentHash, targetPeerId?: string): Promise<T | null> {
    if (await this.storage.has(hash)) {
      const rawBytes = await this.storage.get(hash);
      if (rawBytes) return this.serializer.deserialize<T>(rawBytes);
      return null;
    }

    const contentBigInt = toHashBigInt(hash);
    const visitedPeers = new Set<string>([this.selfPeerId]);

    // Initialize PQ with custom bigint comparator
    const pq = new PriorityQueue<PeerDistance>((a, b) => {
      if (a.distance < b.distance) return -1;
      if (a.distance > b.distance) return 1;
      return 0;
    });

    // Enqueue the targetPeerId if passed, this should be at the first in the queue, as it is highly probable that this peer has the data
    if (targetPeerId) {
      pq.enqueue({ peerId: targetPeerId, distance: calculateXorDistance(toHashBigInt(targetPeerId), contentBigInt) });
    }

    // Enqueue locally known peers
    for (const peerId of this.getKnownPeers()) {
      pq.enqueue({ peerId, distance: calculateXorDistance(toHashBigInt(peerId), contentBigInt) });
    }

    let attempts = 0;
    const MAX_HOPS = 20; // Safety bound for network traversal

    while (!pq.isEmpty() && attempts < MAX_HOPS) {
      const target = pq.dequeue();
      if (!target || visitedPeers.has(target.peerId)) continue;

      visitedPeers.add(target.peerId);
      attempts++;

      try {
        const response = await this.replicationProtocol.requestDataAndAwaitResponse(hash, target.peerId);

        if (response.type === 'replication_content') {
          const rawBytes = response.replicationContent;
          await this.storage.put(hash, rawBytes); // We requested it, so we keep it.
          logger.info(`Successfully retrieved missing data ${hash} via DHT iterative routing.`);
          return this.serializer.deserialize<T>(rawBytes);
        }

        if (response.type === 'replication_error' && response.closestPeers) {
          for (const newPeerId of response.closestPeers) {
            if (!visitedPeers.has(newPeerId)) {
              pq.enqueue({
                peerId: newPeerId,
                distance: calculateXorDistance(toHashBigInt(newPeerId), contentBigInt),
              });
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${hash} from peer ${target.peerId}`, error);
      }
    }

    logger.warn(`Iterative lookup exhausted for ${hash}. Data not found after ${attempts} hops.`);
    return null;
  }

  async onPeerAnnounced(hash: string, peerId: string, handleAnnounce: () => Promise<void>): Promise<void> {
    if (await this.storage.has(hash)) return;
    if (this.inflightTracker.isInflight(hash)) return;
    if (!this.shouldReplicate(hash)) return;

    this.inflightTracker.acquire(hash);
    await this.executeWithRetry(async () => {
      return handleAnnounce();
    })
      .catch((error) => logger.error('Replication request retry failed:', error))
      .finally(() => this.inflightTracker.release(hash));
  }

  async onPeerRequested(
    hash: string,
    peerId: string,
  ): Promise<{ found: true; data: Uint8Array } | { found: false; closestPeers: string[] }> {
    const data = await this.storage.get(hash);
    if (data) {
      return { found: true, data };
    }

    const contentBigInt = toHashBigInt(hash);
    const closestPeers = this.getKnownPeers()
      .map((id) => ({ peerId: id, distance: calculateXorDistance(toHashBigInt(id), contentBigInt) }))
      .sort((a, b) => (a.distance < b.distance ? -1 : 1))
      .slice(0, 3)
      .map((p) => p.peerId);

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
    logger.debug(`Passive replication error from ${peerId}`, { hash, reason });
  }

  private readonly executeWithRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        logger.error(`Failed attempt ${attempt + 1} for replication request, retrying...`);
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

export const kReplicaContentHashReplication = (): DeChatFactory<KReplicaContentReplication> => {
  return (components) => new KReplicaContentReplication(components);
};
