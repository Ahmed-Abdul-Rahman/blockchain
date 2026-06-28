/** biome-ignore-all lint/suspicious/noExplicitAny: <Need a generic GossipSubPropagation Implementation not tied to any specific message type> */
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { Libp2p, Message, SignedMessage } from '@libp2p/interface';
import { LRUCache } from 'lru-cache';
import { GossipSubPropagationMetrics } from '../../metrics/interfaces/GossipSubPropagationMetrics';
import { WireCodec } from '../../shared/serialization/types';
import { DeChatComponents, DeChatFactory } from '../../types';
import { MessageHandler, PropagatedMessage, PropagationContext } from '../types';
import { BroadcastPropagationInterface } from './BroadcastPropagationInterface';

export class GossipSubPropagation implements BroadcastPropagationInterface {
  private node: Libp2p;

  private pubsub: GossipSub;

  /**Map to store seen messages to avoid deduplication of data propagation */
  private seenMessages: Map<string, LRUCache<string, true>>;

  /** Handler function that gets executed when a message is received on the corresponding topics */
  private topicsHandlers: Map<string, Set<MessageHandler<any>>>;

  private config: DeChatComponents['config']['strategies']['propagation']['broadcast'];

  readonly metrics: GossipSubPropagationMetrics;

  private readonly serializer: WireCodec;

  constructor(components: DeChatComponents) {
    this.node = components.libp2p;
    this.config = components.config.strategies.propagation.broadcast;
    this.metrics = components.metrics.gossipSubPropMetrics;
    this.serializer = components.serializer;
    this.pubsub = this.node.services.pubsub as GossipSub;
    this.topicsHandlers = new Map();
    this.seenMessages = new Map();
  }

  start(): void | Promise<void> {
    this.pubsub.addEventListener('message', this.gossipListener.bind(this));
  }

  private gossipListener(event: CustomEvent<Message>) {
    const topic = event.detail.topic;
    const data = event.detail.data;
    const handlers = this.topicsHandlers.get(topic);

    if (!handlers || handlers.size === 0 || !data || data.length > this.config.maxMsgBytes) return;

    try {
      const msg = this.serializer.deserialize<PropagatedMessage<any>>(data);

      if (!msg || !msg.id) return;
      if (this.seenMessages.has(topic) && this.seenMessages.get(topic)?.has(msg.id)) {
        logger.trace('[GossipSubPropagation] Ignoring already seen message');
        this.metrics.messageDropped('duplicate');
        return;
      }
      Object.freeze(msg);

      const cache = this.seenMessages.get(topic);
      if (cache) cache.set(msg.id, true);
      else {
        this.seenMessages.set(topic, this.initializeSeenCache());
        this.seenMessages.get(topic)?.set(msg.id, true);
      }
      for (const handler of handlers) {
        Promise.resolve(
          handler(msg, {
            from: (event.detail as SignedMessage).from,
            receivedAt: Date.now(),
            topic,
          }),
        ).catch((err) => logger.error(`[GossipSubPropagation] Handler error on topic ${topic}: ${err.message}`));
      }
    } catch (error: unknown) {
      logger.warn('[GossipSubPropagation] Error occured while receiving a data propagation message');
      logger.debug(error);
    }
    this.metrics.messageReceived(topic);
  }

  private initializeSeenCache(): LRUCache<string, true> {
    return new LRUCache({
      max: this.config.maxSeenMsgsPerTopic,
      ttl: this.config.msgsTtlMin,
    });
  }

  async publish<T>(topic: string, message: PropagatedMessage<T>): Promise<void> {
    const handler = this.topicsHandlers.get(topic);
    if (!handler) throw new Error(`[GossipSubPropagation] Cannot publish to unregistered topic "${topic}"`);

    const data = this.serializer.serialize(message);
    await this.pubsub.publish(topic, data);
    this.metrics.messagePublished(topic);
  }

  subscribe<T>(
    topic: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => Promise<void> | void,
  ): void {
    if (!this.topicsHandlers.has(topic)) {
      this.topicsHandlers.set(topic, new Set());
      this.pubsub.subscribe(topic);
      logger.debug(`[GossipSubPropagation] Network joined topic: ${topic}`);
    }
    this.topicsHandlers.get(topic)!.add(handler);
    logger.debug(`[GossipSuPropagation] Local handler attached to topic: ${topic}`);
  }

  unsubscribe<T>(topic: string, handler: MessageHandler<T>, purgeData?: boolean): void {
    const handlers = this.topicsHandlers.get(topic);
    if (handlers) {
      handlers.delete(handler);
      logger.debug(`[GossipSubPropagation] Local handler detached from topic: ${topic}`);
      if (handlers.size === 0) {
        this.topicsHandlers.delete(topic);
        this.pubsub.unsubscribe(topic);
        if (purgeData) this.seenMessages.delete(topic);
        logger.debug(`[GossipSubPropagation] Network left topic: ${topic} (No more local listeners)`);
      }
    }
  }

  stop(): void {
    this.pubsub.removeEventListener('message', this.gossipListener);
    this.topicsHandlers.keys().forEach((topic) => {
      const handlers = this.topicsHandlers.get(topic);
      handlers?.clear();
      this.topicsHandlers.delete(topic);
      this.pubsub.unsubscribe(topic);
    });
  }

  clearMessages(topic?: string): void {
    if (topic) return this.seenMessages.get(topic)?.clear();
    this.seenMessages.clear();
  }

  getSeenMessages(): ReadonlyMap<string, LRUCache<string, true>> {
    return new Map(this.seenMessages);
  }
}

export const gossipSubPropagation = (): DeChatFactory<GossipSubPropagation> => {
  return (components) => new GossipSubPropagation(components);
};
