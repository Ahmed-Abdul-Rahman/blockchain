import { createHash } from 'node:crypto';
import { logger } from '@dechat/common';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { ContentHashStrategy } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash, DataSerializer } from './types';

export class KReplicaContentHashReplication implements DataReplicationInterface {
  public constructor(
    private readonly selfPeerId: string,
    private readonly getKnownPeers: () => string[],
    private readonly hashStrategy: ContentHashStrategy,
    private readonly storage: ReplicaStoreInterface,
    private readonly serializer: DataSerializer,
    readonly replicationProtocol: ReplicationProtocolInterface,
    private readonly kReplicaCount: number,
  ) {}

  public readonly start = async (): Promise<void> => {
    await this.replicationProtocol.start();
  };

  public readonly stop = async (): Promise<void> => {
    await this.replicationProtocol.stop();
  };

  /**
   * Converts a string input to a 256-bit numeric representation using SHA-256.
   * This projects PeerIds and ContentHashes into the exact same logical keyspace.
   * * @param input - The string identifier to hash (e.g., PeerId or ContentHash)
   * @returns {bigint} The numeric representation of the SHA-256 hash.
   */
  private readonly toHashBigInt = (input: string): bigint => {
    const hexHash = createHash('sha256').update(input).digest('hex');
    return BigInt(`0x${hexHash}`);
  };

  /**
   * Calculates the XOR distance between a peer's hash and the content's hash.
   * * @param peerHashBigInt - The SHA-256 hash of the peer ID parsed as a BigInt.
   * @param contentHashBigInt - The SHA-256 hash of the content parsed as a BigInt.
   * @returns {bigint} The absolute XOR distance.
   */
  private readonly calculateXorDistance = (peerHashBigInt: bigint, contentHashBigInt: bigint): bigint => {
    return peerHashBigInt ^ contentHashBigInt;
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

    const contentBigInt = this.toHashBigInt(hash);
    const selfBigInt = this.toHashBigInt(this.selfPeerId);
    const selfDistance = this.calculateXorDistance(selfBigInt, contentBigInt);

    let closerPeersCount = 0;

    for (const peerId of knownPeers) {
      const peerBigInt = this.toHashBigInt(peerId);
      const peerDistance = this.calculateXorDistance(peerBigInt, contentBigInt);

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
}
