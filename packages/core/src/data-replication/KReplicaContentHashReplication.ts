import { logger } from '@dechat/common';
import { PeerId } from '@libp2p/interface';
import { DirectPropagationInterface } from '../data-propagation/direct/DirectPropagationInterface';
import { SimplePeerScorer } from '../networking/SimplePeerScorer';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { ContentHashStrategy } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash, DataSerializer } from './types';

export class KReplicaContentHashReplication implements DataReplicationInterface {
  public constructor(
    private readonly selfPeerId: PeerId,
    private readonly hashStrategy: ContentHashStrategy,
    private readonly storage: ReplicaStoreInterface,
    private readonly serializer: DataSerializer,
    private readonly directPropagation: DirectPropagationInterface,
    private readonly peerScorer: SimplePeerScorer,
    private readonly replicaCount: number,
    readonly replicationProtocol: ReplicationProtocolInterface,
  ) {}

  public readonly start = async (): Promise<void> => {
    await this.replicationProtocol.start();
  };

  public readonly stop = async (): Promise<void> => {
    await this.replicationProtocol.stop();
  };

  public readonly shouldReplicate = (_hash: ContentHash, _fromPeer?: string): boolean => true;

  public readonly onLocalDataProduced = async <T>(data: T): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;
    if (!this.shouldReplicate(hash)) return;

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

  public readonly replicate = async <T>(hash: ContentHash, data: T): Promise<void> => {
    logger.debug('[Replication] replicate() bypassed → protocol driven');
    // const peers = this.peerScorer.getBestScorePeers(this.replicaCount);

    // const propagationMessage = {
    //   id: hash,
    //   payload: data,
    //   from: this.selfPeerId.toString(),
    //   timestamp: now(),
    // } as PropagatedMessage<T>;

    // //TODO: currently sending to a dummy protocol refactor it to use replication protocol and handle it there
    // await Promise.all(
    //   peers.map((peerId) =>
    //     this.directPropagation
    //       .send(peerId, 'Dummy', propagationMessage)
    //       .catch((error) => logger.error('Replication send failed to peer: ', peerId, ' ', error)),
    //   ),
    // );
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
