import { ReplicationProtocolInterface } from './replication-protocol/ReplicationProtocolInterface';
import { ContentHash } from './types';

export interface DataReplicationInterface {
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * // TODO: implement batching, accept a list of dataItems and replicate each item efficiently and non-blocking
   * Called when local node produces new data
   */
  onLocalDataProduced<T>(data: T): Promise<void>;

  /**
   * // TODO: Check if possible, this function might be called many times within a small timespan, see if it could be debounced and process all the calls in one batch
   * Called when data is received from the network
   */
  onRemoteDataReceived<T>(data: T, fromPeerId: string): Promise<void>;

  /**
   * Decides if this node should persist the data
   */
  shouldReplicate(hash: ContentHash, fromPeerId?: string): boolean;

  /**
   * Optional eviction hook
   */
  evict?(contentHash: string): Promise<void>;

  /**
   * Replication protocol implementation to be used by this data replication
   */
  readonly replicationProtocol: ReplicationProtocolInterface;
}
