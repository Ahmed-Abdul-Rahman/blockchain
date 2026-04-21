import { logger } from '@dechat/common';
import { PeerId } from '@libp2p/interface';
import { DirectPropagationInterface } from '../data-propagation/direct/DirectPropagationInterface';
import { PropagatedMessage } from '../data-propagation/types';
import { SimplePeerScorer } from '../networking/SimplePeerScorer';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { now } from '../utils';
import { ContentHashStrategy } from './content-hash/types';
import { DataReplicationInterface } from './DataReplicationInterface';
import { ContentHash, DataSerializer } from './types';
import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';

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

  public readonly start = async (): Promise<void> => {};

  public readonly stop = async (): Promise<void> => {};

  public readonly shouldReplicate = (hash: ContentHash, fromPeer?: string): boolean => true;

  public readonly onLocalDataProduced = async <T>(data: T): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;
    if (!this.shouldReplicate(hash)) return;

    await this.replicate(hash, data);
    await this.persist(hash, data);
  };

  public readonly onRemoteDataReceived = async <T>(data: T, fromPeer: string): Promise<void> => {
    const hash = this.hashStrategy.hash(data);

    if (await this.storage.has(hash)) return;
    if (!this.shouldReplicate(hash, fromPeer)) return;

    await this.persist(hash, data);
    await this.replicate(hash, data);
  };

  public readonly replicate = async <T>(hash: ContentHash, data: T): Promise<void> => {
    const peers = this.peerScorer.getBestScorePeers(this.replicaCount);

    const propagationMessage = {
      id: hash,
      payload: data,
      from: this.selfPeerId.toString(),
      timestamp: now(),
    } as PropagatedMessage<T>;

    //TODO: currently sending to a dummy protocol refactor it to use replication protocol and handle it there
    await Promise.all(
      peers.map((peerId) =>
        this.directPropagation
          .send(peerId, 'Dummy', propagationMessage)
          .catch((error) => logger.error('Replication send failed to peer: ', peerId, ' ', error)),
      ),
    );
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
