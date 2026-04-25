import { logger } from '@dechat/common';
import { calculateXorDistance, toHashBigInt } from '@dechat/crypto';
import { PeerId } from '@libp2p/interface';
import { BroadcastPropagationInterface } from '../../data-propagation/broadcast/BroadcastPropagationInterface';
import { DirectPropagationInterface } from '../../data-propagation/direct/DirectPropagationInterface';
import { PropagatedMessage, PropagationContext } from '../../data-propagation/types';
import { ReplicaStoreInterface } from '../../replica-store/ReplicaStoreInterface';
import { ContentHashStrategy } from '../content-hash/types';
import { ContentHash } from '../types';
import { InflightRequestTracker } from './InflightRequestTracker';
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
  inflightTracker: InflightRequestTracker;
  hashStrategy: ContentHashStrategy;
  transportSelector: TransportSelector;
  storage: ReplicaStoreInterface;
  getKnownPeers: () => string[];
}

export class ReplicationMessageProtocolManager implements ReplicationProtocolInterface {
  readonly selfPeerId: PeerId;
  readonly hashStrategy: ContentHashStrategy;
  readonly topic: string = '/deChat/v1/topic/replication-protocol';
  readonly protocol: string = '/deChat/v1/protocol/replication-protocol';
  readonly maxConcurrentUploads: number = 100;
  readonly transportSelector: TransportSelector;
  readonly inflightTracker: InflightRequestTracker;
  readonly directProp: DirectPropagationInterface;
  readonly broadcastProp: BroadcastPropagationInterface;
  readonly storage: ReplicaStoreInterface;
  private readonly getKnownPeers: () => string[];
  /** Maps correlation keys (hash:peerId) to Promise resolvers */
  private pendingRequests: Map<
    string,
    {
      resolve: (msg: ReplicationContent | ReplicationError) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >;

  private shouldReplicate: ((hash: ContentHash, _fromPeer?: string) => boolean) | undefined;

  maxAttempts: number = 3;
  baseDelayMs: number = 200;

  constructor(selfPeerId: PeerId, opts: ReplicationManagerOptions) {
    this.selfPeerId = selfPeerId;
    this.transportSelector = opts.transportSelector;
    this.inflightTracker = opts.inflightTracker;
    this.directProp = opts.direct;
    this.broadcastProp = opts.broadcast;
    this.hashStrategy = opts.hashStrategy;
    this.storage = opts.storage;
    this.getKnownPeers = opts.getKnownPeers;

    this.pendingRequests = new Map();

    this.directProp.onReceive(this.protocol, this.handleIncomingDirect.bind(this));
    this.broadcastProp.subscribe(this.topic, this.handleIncomingBroadcast.bind(this));
  }

  async start(): Promise<void> {
    logger.info('[ReplicationProtocol] Started:', this.selfPeerId);
  }

  async stop(): Promise<void> {
    await this.directProp.stop?.();
    await this.broadcastProp.unsubscribe(this.topic);
    logger.info('[ReplicationProtocol] Stopped:', this.selfPeerId);
  }

  public readonly announceToNetwork = async (hash: ContentHash): Promise<void> => {
    const msg: ReplicationAnnounce = {
      type: 'replication_announce',
      hash,
    };
    await this.sendMessage(msg).catch((error) => logger.error('Announcing replication hash failed: ', error));
  };

  public registerShouldReplicateCallback(shouldReplicateCallback: (hash: ContentHash, _fromPeer?: string) => boolean) {
    this.shouldReplicate = shouldReplicateCallback;
  }

  async onAnnounce(msg: PropagatedMessage<ReplicationAnnounce>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    const { from } = msg;

    if (await this.storage.has(hash)) return;
    if (this.inflightTracker.isInflight(hash)) return;
    if (this.shouldReplicate && !this.shouldReplicate(hash)) return;

    this.inflightTracker.acquire(hash);
    await this.executeWithRetry(async () => {
      const request: ReplicationRequest = {
        type: 'replication_request',
        hash,
      };
      await this.sendMessage(request, from);
    })
      .catch((error) => logger.error('Request retry failed:', error))
      .finally(() => this.inflightTracker.release(hash));
  }

  async onRequest(msg: PropagatedMessage<ReplicationRequest>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    const { from } = msg;
    const data = await this.storage.get(hash);

    if (!data) {
      const contentBigInt = toHashBigInt(hash);
      const closerPeers = this.getKnownPeers()
        .map((peerId) => ({
          peerId,
          distance: calculateXorDistance(toHashBigInt(peerId), contentBigInt),
        }))
        .sort((a, b) => (a.distance < b.distance ? -1 : 1))
        .slice(0, 3)
        .map((p) => p.peerId);

      const errorMessage: ReplicationError = {
        type: 'replication_error',
        hash,
        reason: 'not_found',
        closerPeers,
      };
      await this.sendMessage(errorMessage, from).catch((error) =>
        logger.error('Sending replication error response failed: ', error),
      );
      return;
    }

    const content: ReplicationContent = {
      type: 'replication_content',
      hash: hash,
      replicationContent: Array.from(data),
    };

    await this.sendMessage(content, from).catch((error) => logger.error('Failed sending replication content:', error));
  }

  async onContent(msg: PropagatedMessage<ReplicationContent>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    const peerIdStr = ctx?.from.toString() ?? msg.from;

    const isExplicitRequest = this.resolvePendingRequest(hash, peerIdStr, msg.payload);
    if (isExplicitRequest) return;

    if (await this.storage.has(hash)) return;
    if (this.shouldReplicate && !this.shouldReplicate(hash)) return;

    if (this.inflightTracker.isInflight(hash)) {
      this.inflightTracker.release(hash);
    }
    const bytesToStore = new Uint8Array(msg.payload.replicationContent);
    await this.storage.put(hash, bytesToStore);
  }

  async onError(msg: PropagatedMessage<ReplicationError>, ctx?: PropagationContext): Promise<void> {
    const { hash, reason } = msg.payload;
    const peerIdStr = ctx?.from.toString() ?? msg.from;

    this.resolvePendingRequest(hash, peerIdStr, msg.payload);

    if (this.inflightTracker.isInflight(hash)) {
      this.inflightTracker.release(hash);
    }
    logger.warn('[ReplicationError]', { hash, reason });
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
            await this.onAnnounce(message as PropagatedMessage<ReplicationAnnounce>, ctx);
            break;
          case 'replication_request':
            await this.onRequest(message as PropagatedMessage<ReplicationRequest>, ctx);
            break;
          case 'replication_content':
            await this.onContent(message as PropagatedMessage<ReplicationContent>, ctx);
            break;
          case 'replication_error':
            await this.onError(message as PropagatedMessage<ReplicationError>, ctx);
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
