import { logger } from '@dechat/common';
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
}

export class ReplicationMessageProtocolManager implements ReplicationProtocolInterface {
  readonly selfPeerId: PeerId;
  readonly hashStrategy: ContentHashStrategy;
  readonly protocol: string = '/deChat/v1/topic/replication-protocol';
  readonly maxConcurrentUploads: number = 100;
  readonly transportSelector: TransportSelector;
  readonly inflightTracker: InflightRequestTracker;
  readonly directProp: DirectPropagationInterface;
  readonly broadcastProp: BroadcastPropagationInterface;
  readonly storage: ReplicaStoreInterface;

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

    this.directProp.onReceive(this.protocol, this.handleIncomingDirect.bind(this));
    this.broadcastProp.subscribe(this.protocol, this.handleIncomingBroadcast.bind(this));
  }

  async start(): Promise<void> {
    logger.info('[ReplicationProtocol] Started:', this.selfPeerId);
  }

  async stop(): Promise<void> {
    await this.directProp.stop?.();
    await this.broadcastProp.unsubscribe('topic:' + this.protocol);
    logger.info('[ReplicationProtocol] Stopped:', this.selfPeerId);
  }

  public readonly announceToNetwork = async (hash: ContentHash): Promise<void> => {
    const msg: ReplicationAnnounce = {
      type: 'replication_announce',
      hash,
    };
    await this.sendMessage(msg, undefined, 'topic:' + this.protocol).catch((error) =>
      logger.error('Announcing replication hash failed: ', error),
    );
  };

  async onAnnounce(msg: PropagatedMessage<ReplicationAnnounce>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    const { from } = msg;

    if (await this.storage.has(hash)) return;
    if (this.inflightTracker.isInflight(hash)) return;

    this.inflightTracker.acquire(hash);
    await this.executeWithRetry(async () => {
      const request: ReplicationRequest = {
        type: 'replication_request',
        hash,
      };
      await this.sendMessage(request, from, this.protocol);
    })
      .catch((error) => logger.error('Request retry failed:', error))
      .finally(() => this.inflightTracker.release(hash));
  }

  async onRequest(msg: PropagatedMessage<ReplicationRequest>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    const { from } = msg;
    const data = await this.storage.get(hash);

    if (!data) {
      const errorMessage: ReplicationError = {
        type: 'replication_error',
        hash,
        reason: 'not_found',
      };
      await this.sendMessage(errorMessage, from, this.protocol).catch((error) =>
        logger.error('Sending replication error response failed: ', error),
      );
      return;
    }

    const content: ReplicationContent = {
      type: 'replication_content',
      hash: hash,
      replicationContent: Array.from(data),
    };

    await this.sendMessage(content, from, this.protocol).catch((error) =>
      logger.error('Failed sending replication content:', error),
    );
  }

  async onContent(msg: PropagatedMessage<ReplicationContent>, ctx?: PropagationContext): Promise<void> {
    const { hash } = msg.payload;
    if (await this.storage.has(hash)) return;
    if (this.inflightTracker.isInflight(hash)) {
      this.inflightTracker.release(hash);
    }
    const bytesToStore = new Uint8Array(msg.payload.replicationContent);
    await this.storage.put(hash, bytesToStore);
  }

  async onError(msg: PropagatedMessage<ReplicationError>, ctx?: PropagationContext): Promise<void> {
    const { hash, reason } = msg.payload;
    if (this.inflightTracker.isInflight(hash)) {
      this.inflightTracker.release(hash);
    }
    logger.warn('[ReplicationError]', { hash, reason });
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

  async sendMessage(msg: ReplicationMessage, peerId?: string, topic?: string): Promise<void> {
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
      if (!topic) throw new Error('gossip transport requires topic');
      await this.broadcastProp.publish(topic, propagated);
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
