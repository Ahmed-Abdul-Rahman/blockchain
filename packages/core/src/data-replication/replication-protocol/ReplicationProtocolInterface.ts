import { PropagatedMessage, PropagationContext } from '../../data-propagation/types';
import { ReplicaStoreInterface } from '../../replica-store/ReplicaStoreInterface';
import { ContentHashStrategy } from '../content-hash/types';
import { ContentHash } from '../types';

export type ReplicationMessageType =
  | 'replication_announce'
  | 'replication_request'
  | 'replication_content'
  | 'replication_error';

export interface ReplicationAnnounce {
  type: 'replication_announce';
  hash: ContentHash;
}

export interface ReplicationRequest {
  type: 'replication_request';
  hash: ContentHash;
}

export interface ReplicationContent {
  type: 'replication_content';
  hash: ContentHash;
  replicationContent: Array<number>;
}

export interface ReplicationError {
  type: 'replication_error';
  hash: ContentHash;
  reason: 'not_found' | 'overloaded';
  /** * Routing hint: If not_found, return the PeerIds of the closest nodes
   * the answering peer knows about.
   */
  closerPeers?: string[];
}

export type ReplicationMessage = ReplicationAnnounce | ReplicationRequest | ReplicationContent | ReplicationError;

/**
 * Pluggable replication protocol interface.
 * Implementations (e.g. KReplicaContentHashReplication) implement this.
 */
export interface ReplicationProtocolInterface {
  hashStrategy: ContentHashStrategy;

  storage: ReplicaStoreInterface;

  protocol: string;

  announceToNetwork(hash: ContentHash): Promise<void>;

  requestDataAndAwaitResponse(hash: string, targetPeerId: string): Promise<ReplicationContent | ReplicationError>;

  registerShouldReplicateCallback(shouldReplicateCallback: (hash: ContentHash, _fromPeer?: string) => boolean): void;
  /**
   * Handles an incoming replication announce message.
   * @param msg
   * @param ctx
   */
  onAnnounce(msg: PropagatedMessage<ReplicationAnnounce>, ctx?: PropagationContext): Promise<void>;

  /**
   * Handles an incoming replication request message.
   * @param msg
   * @param ctx
   */
  onRequest(msg: PropagatedMessage<ReplicationRequest>, ctx?: PropagationContext): Promise<void>;

  /**
   * Handles an incoming replication content message.
   * @param msg
   * @param ctx
   */
  onContent(msg: PropagatedMessage<ReplicationContent>, ctx?: PropagationContext): Promise<void>;

  /**
   * Handles an incoming replication error message.
   * @param msg
   * @param ctx
   */
  onError(msg: PropagatedMessage<ReplicationError>, ctx?: PropagationContext): Promise<void>;

  /**
   * Starts the replication protocol.
   * @returns A promise that resolves when the protocol is started.
   */
  start(): Promise<void>;

  /**
   * Stops the replication protocol.
   * @returns A promise that resolves when the protocol is stopped.
   */
  stop(): Promise<void>;
}
