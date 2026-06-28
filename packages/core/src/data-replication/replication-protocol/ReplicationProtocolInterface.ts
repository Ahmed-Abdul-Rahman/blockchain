import { Startable } from '@libp2p/interface';
import { PropagatedMessage, PropagationContext } from '../../data-propagation/types';
import { ContentHash } from '../types';
import { ReplicationEngineDelegate } from './ReplicationEngineDelegateInterface';

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
  replicationContent: Uint8Array;
}

export interface ReplicationError {
  type: 'replication_error';
  hash: ContentHash;
  reason: 'not_found' | 'overloaded';
  /** * Routing hint: If not_found, return the PeerIds of the closest nodes
   * the answering peer knows about.
   */
  closestPeers?: string[];
}

export type ReplicationMessage = ReplicationAnnounce | ReplicationRequest | ReplicationContent | ReplicationError;

/**
 * Pluggable replication protocol interface.
 * Implementations (e.g. KReplicaContentHashReplication) implement this.
 */
export interface ReplicationProtocolInterface extends Startable {
  announceToNetwork(hash: ContentHash): Promise<void>;

  requestDataAndAwaitResponse(hash: string, targetPeerId: string): Promise<ReplicationContent | ReplicationError>;

  /**
   * Injects the replication engine to handle business logic.
   */
  setDelegate(delegate: ReplicationEngineDelegate): void;

  /**
   * Handles an incoming replication announce message.
   * @param msg
   * @param ctx
   */
  handleAnnounce(msg: PropagatedMessage<ReplicationAnnounce>, ctx?: PropagationContext): Promise<void>;

  /**
   * Handles an incoming replication request message.
   * @param msg
   * @param ctx
   */
  handleRequest(msg: PropagatedMessage<ReplicationRequest>, ctx?: PropagationContext): Promise<void>;

  /**
   * Handles an incoming replication content message.
   * @param msg
   * @param ctx
   */
  handleContent(msg: PropagatedMessage<ReplicationContent>, ctx?: PropagationContext): Promise<void>;

  /**
   * Handles an incoming replication error message.
   * @param msg
   * @param ctx
   */
  handleError(msg: PropagatedMessage<ReplicationError>, ctx?: PropagationContext): Promise<void>;
}
