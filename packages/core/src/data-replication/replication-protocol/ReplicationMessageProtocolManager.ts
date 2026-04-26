import { logger } from '@dechat/common';
import { PeerId } from '@libp2p/interface';
import { BroadcastPropagationInterface } from '../../data-propagation/broadcast/BroadcastPropagationInterface';
import { DirectPropagationInterface } from '../../data-propagation/direct/DirectPropagationInterface';
import { PropagatedMessage, PropagationContext } from '../../data-propagation/types';
import { ContentHash } from '../types';
import { ReplicationEngineDelegate } from './ReplicationEngineDelegateInterface';
import {
  ReplicationAnnounce,
  ReplicationContent,
  ReplicationError,
  ReplicationMessage,
  ReplicationProtocolInterface,
  ReplicationRequest,
} from './ReplicationProtocolInterface';
import { TransportSelector } from './TransportSelector';

export interface ReplicationManagerOptions {
  broadcast: BroadcastPropagationInterface;
  direct: DirectPropagationInterface;
  transportSelector: TransportSelector;
}

export class ReplicationMessageProtocolManager implements ReplicationProtocolInterface {
  readonly selfPeerId: PeerId;
  readonly topic: string = '/deChat/v1/topic/replication-protocol';
  readonly protocol: string = '/deChat/v1/protocol/replication-protocol';
  readonly maxConcurrentUploads: number = 100;
  readonly transportSelector: TransportSelector;
  readonly directProp: DirectPropagationInterface;
  readonly broadcastProp: BroadcastPropagationInterface;

  /** Maps correlation keys (hash:peerId) to Promise resolvers */
  private pendingRequests: Map<
    string,
    {
      resolve: (msg: ReplicationContent | ReplicationError) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >;

  private delegate?: ReplicationEngineDelegate;

  constructor(selfPeerId: PeerId, opts: ReplicationManagerOptions) {
    this.selfPeerId = selfPeerId;
    this.transportSelector = opts.transportSelector;
    this.directProp = opts.direct;
    this.broadcastProp = opts.broadcast;

    this.pendingRequests = new Map();

    this.directProp.onReceive(this.protocol, this.handleIncomingDirect.bind(this));
    this.broadcastProp.subscribe(this.topic, this.handleIncomingBroadcast.bind(this));
  }

  public setDelegate(delegate: ReplicationEngineDelegate): void {
    this.delegate = delegate;
  }

  async start(): Promise<void> {
    logger.info('[ReplicationProtocol] Started:', this.selfPeerId);
  }

  async stop(): Promise<void> {
    logger.info('[ReplicationProtocol] Stopped:', this.selfPeerId);
  }

  public readonly announceToNetwork = async (hash: ContentHash): Promise<void> => {
    const msg: ReplicationAnnounce = { type: 'replication_announce', hash };
    await this.sendMessage(msg).catch((error) => logger.error('Announcing replication hash failed: ', error));
  };

  async handleAnnounce(msg: PropagatedMessage<ReplicationAnnounce>, ctx?: PropagationContext): Promise<void> {
    if (this.delegate) {
      const { payload, from } = msg;
      await this.delegate.onPeerAnnounced(payload.hash, from, () => {
        const request: ReplicationRequest = {
          type: 'replication_request',
          hash: payload.hash,
        };
        return this.sendMessage(request, from);
      });
    }
  }

  async handleRequest(msg: PropagatedMessage<ReplicationRequest>, ctx?: PropagationContext): Promise<void> {
    if (!this.delegate) return;

    const { hash } = msg.payload;
    const { from } = msg;

    const result = await this.delegate.onPeerRequested(hash, from);

    if (result.found) {
      const content: ReplicationContent = {
        type: 'replication_content',
        hash,
        replicationContent: Array.from(result.data),
      };
      await this.sendMessage(content, from).catch((error) =>
        logger.error('Failed sending replication content:', error),
      );
    } else {
      const errorMessage: ReplicationError = {
        type: 'replication_error',
        hash,
        reason: 'not_found',
        closestPeers: result.closestPeers,
      };
      await this.sendMessage(errorMessage, from).catch((error) =>
        logger.error('Sending replication error response failed: ', error),
      );
    }
  }

  async handleContent(msg: PropagatedMessage<ReplicationContent>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    const peerIdStr = ctx?.from?.toString() ?? msg.from;

    const isExplicitRequest = this.resolvePendingRequest(hash, peerIdStr, msg.payload);

    if (!isExplicitRequest && this.delegate) {
      const bytes = new Uint8Array(msg.payload.replicationContent);
      await this.delegate.onPeerDeliveredContent(hash, bytes, peerIdStr);
    }
  }

  async handleError(msg: PropagatedMessage<ReplicationError>, ctx?: PropagationContext): Promise<void> {
    const { hash, reason, closestPeers } = msg.payload;
    const peerIdStr = ctx?.from?.toString() ?? msg.from;

    const isExplicitRequest = this.resolvePendingRequest(hash, peerIdStr, msg.payload);

    if (!isExplicitRequest && this.delegate) {
      await this.delegate.onPeerReportedError(hash, reason, closestPeers, peerIdStr);
    }
  }

  /**
   * Helper to resolve correlated incoming direct messages
   */
  private resolvePendingRequest(hash: string, peerId: string, payload: ReplicationContent | ReplicationError): boolean {
    const key = `${hash}:${peerId}`;
    const pending = this.pendingRequests.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(payload);
      this.pendingRequests.delete(key);
      return true; // Intercepted: This was an active fetch
    }
    return false; // Not intercepted: This was a passive gossip push
  }

  /**
   * Sends a request to a peer and waits for a CONTENT or ERROR response.
   * Uses a correlation ID of `hash:targetPeerId` and a 5-second timeout.
   * @param hash - Target content hash
   * @param targetPeerId - Peer to request from
   * @returns Promise resolving to the peer's explicit response
   */
  public requestDataAndAwaitResponse(
    hash: string,
    targetPeerId: string,
  ): Promise<ReplicationContent | ReplicationError> {
    return new Promise((resolve, reject) => {
      const key = `${hash}:${targetPeerId}`;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(key);
        reject(new Error(`Timeout waiting for data ${hash} from peer ${targetPeerId}`));
      }, 7000);

      this.pendingRequests.set(key, { resolve, reject, timer });

      const request: ReplicationRequest = { type: 'replication_request', hash };
      this.sendMessage(request, targetPeerId).catch((error) => {
        clearTimeout(timer);
        this.pendingRequests.delete(key);
        reject(error);
      });
    });
  }

  async handleIncomingBroadcast<T>(message: PropagatedMessage<T>, ctx?: PropagationContext): Promise<void> {
    try {
      const payload = message.payload as ReplicationMessage;
      // If this is an explicit replication control message, dispatch to protocol handlers
      if (
        payload &&
        typeof payload === 'object' &&
        typeof payload.type === 'string' &&
        payload.type.startsWith('replication_')
      ) {
        switch (payload.type) {
          case 'replication_announce':
            await this.handleAnnounce(message as PropagatedMessage<ReplicationAnnounce>, ctx);
            break;
          case 'replication_request':
            await this.handleRequest(message as PropagatedMessage<ReplicationRequest>, ctx);
            break;
          case 'replication_content':
            await this.handleContent(message as PropagatedMessage<ReplicationContent>, ctx);
            break;
          case 'replication_error':
            await this.handleError(message as PropagatedMessage<ReplicationError>, ctx);
            break;
          default:
            break;
        }
      } else {
        logger.warn('Expected a replication protocol message, received', payload?.type);
      }
    } catch (err) {
      logger.error('Error handling incoming replication message', err);
    }
  }

  async handleIncomingDirect<T>(message: PropagatedMessage<T>, ctx?: PropagationContext): Promise<void> {
    // direct channel typically carries REQUEST/CONTENT/ERROR
    await this.handleIncomingBroadcast(message, ctx);
  }

  async sendMessage(msg: ReplicationMessage, peerId?: string): Promise<void> {
    const transport = this.transportSelector.select(msg.type);

    const propagated = {
      id: msg.hash ?? '',
      payload: msg,
      from: this.selfPeerId.toString(),
      timestamp: Date.now(),
    } as PropagatedMessage<ReplicationMessage>;

    if (transport === 'direct') {
      if (!peerId) throw new Error('direct transport requires peerId');
      await this.directProp.send(peerId, this.protocol, propagated);
    } else {
      await this.broadcastProp.publish(this.topic, propagated);
    }
  }
}
