import { PriorityQueue } from '@datastructures-js/priority-queue';
import { logger } from '@dechat/common';
import { calculateXorDistance, toHashBigInt } from '@dechat/crypto';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { ContentHashStrategy } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash, DataSerializer } from './types';

interface PeerDistance {
  peerId: string;
  distance: bigint;
}

export class KReplicaContentHashReplication implements DataReplicationInterface {
  public constructor(
    private readonly selfPeerId: string,
    private readonly getKnownPeers: () => string[],
    private readonly hashStrategy: ContentHashStrategy,
    private readonly storage: ReplicaStoreInterface,
    private readonly serializer: DataSerializer,
    readonly replicationProtocol: ReplicationProtocolInterface,
    private readonly kReplicaCount: number,
  ) {
    this.replicationProtocol.registerShouldReplicateCallback(this.shouldReplicate.bind(this));
  }

  public readonly start = async (): Promise<void> => {
    await this.replicationProtocol.start();
  };

  public readonly stop = async (): Promise<void> => {
    await this.replicationProtocol.stop();
  };

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
    if (totalNetworkView <= this.kReplicaCount) return true;

    const contentBigInt = toHashBigInt(hash);
    const selfBigInt = toHashBigInt(this.selfPeerId);
    const selfDistance = calculateXorDistance(selfBigInt, contentBigInt);

    let closerPeersCount = 0;

    for (const peerId of knownPeers) {
      const peerBigInt = toHashBigInt(peerId);
      const peerDistance = calculateXorDistance(peerBigInt, contentBigInt);

      if (peerDistance < selfDistance) {
        closerPeersCount++;
      }

      // Early exit: We are outside the top K closest replicas
      if (closerPeersCount >= this.kReplicaCount) {
        return false;
      }
    }

    return true;
  };

  public readonly onLocalDataProduced = async <T>(data: T): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;

    await this.persist(hash, data);

    // ANNOUNCE instead of direct send
    await this.replicationProtocol.announceToNetwork(hash);
  };

  public readonly onRemoteDataReceived = async <T>(data: T, fromPeer: string): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;
    if (!this.shouldReplicate(hash, fromPeer)) return;

    await this.persist(hash, data);

    // propagate further (gossip-style spread)
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

          // UNCONDITIONAL STORAGE: We requested it, so we keep it.
          await this.storage.put(hash, rawBytes);

          logger.info(`Successfully retrieved missing data ${hash} via DHT iterative routing.`);
          return this.serializer.deserialize<T>(rawBytes);
        }

        if (response.type === 'replication_error' && response.closerPeers) {
          for (const newPeerId of response.closerPeers) {
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
}
