import { PriorityQueue } from '@datastructures-js/priority-queue';
import { logger } from '@dechat/common';
import { calculateXorDistance, toHashBigInt } from '@dechat/crypto';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { ContentHashStrategy } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { InflightRequestTracker } from './replication-protocol/InflightRequestTracker';
import { ReplicationEngineDelegate } from './replication-protocol/ReplicationEngineDelegateInterface';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash, DataSerializer } from './types';

interface PeerDistance {
  peerId: string;
  distance: bigint;
}

export class KReplicaContentHashReplication implements DataReplicationInterface, ReplicationEngineDelegate {
  private inflightTracker: InflightRequestTracker;

  public constructor(
    private selfPeerId: string,
    private getKnownPeers: () => string[],
    private hashStrategy: ContentHashStrategy,
    private storage: ReplicaStoreInterface,
    private serializer: DataSerializer,
    readonly replicationProtocol: ReplicationProtocolInterface,
    readonly kReplicaCount: number = 3,
    readonly maxAttempts: number = 3,
    readonly baseDelayMs: number = 200,
  ) {
    this.inflightTracker = new InflightRequestTracker();
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
    const target = Math.min(this.kReplicaCount, 3);
    if (totalNetworkView <= target) return true;

    const contentBigInt = toHashBigInt(hash);
    const selfBigInt = toHashBigInt(this.selfPeerId);
    const selfDistance = calculateXorDistance(selfBigInt, contentBigInt);

    let closestPeersCount = 0;

    for (const peerId of knownPeers) {
      const peerBigInt = toHashBigInt(peerId);
      const peerDistance = calculateXorDistance(peerBigInt, contentBigInt);
      if (peerDistance < selfDistance) closestPeersCount++;
      if (closestPeersCount >= this.kReplicaCount) return false;
    }
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
    await this.storage.delete(hash);
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
  public async requestMissingData<T>(hash: ContentHash): Promise<T | null> {
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
          const rawBytes = new Uint8Array(response.replicationContent);
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

  public readonly executeWithRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        logger.error(`Failed attempt ${attempt + 1} for replication request, retrying...`);
        attempt++;
        if (attempt >= this.maxAttempts) {
          throw error;
        }
        const delay = this.baseDelayMs * 2 ** (attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  };
}

export const createReplicationEngine = (
  selfPeerId: string,
  getKnownPeers: () => string[],
  hashStrategy: ContentHashStrategy,
  storage: ReplicaStoreInterface,
  serializer: DataSerializer,
  replicationProtocol: ReplicationProtocolInterface,
  replicaCount: number = 3,
): KReplicaContentHashReplication => {
  const engine = new KReplicaContentHashReplication(
    selfPeerId,
    getKnownPeers,
    hashStrategy,
    storage,
    serializer,
    replicationProtocol,
    replicaCount,
  );

  replicationProtocol.setDelegate(engine);

  return engine;
};
