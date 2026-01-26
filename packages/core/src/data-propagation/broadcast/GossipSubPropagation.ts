/** biome-ignore-all lint/suspicious/noExplicitAny: <Need a generic GossipSubPropagation Implementation not tied to any specific message type> */
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { Libp2p, Message, SignedMessage } from '@libp2p/interface';
import { LRUCache } from 'lru-cache';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { GossipSubPropagationMetrics } from '../../metrics/interfaces/GossipSubPropagationMetrics';
import { PropagatedMessage, PropagationContext } from '../types';
import { BroadcastPropagationInterface } from './BroadcastPropagationInterface';

export class GossipSubPropagation implements BroadcastPropagationInterface {
  private node: Libp2p;

  private pubsub: GossipSub;

  /**Map to store seen messages to avoid deduplication of data propagation */
  private seenMessages: Map<string, LRUCache<string, true>>;

  /** Listener for listening to gossip messages */
  private gossipListener: (event: CustomEvent<Message>) => void;

  /** Handler function that gets executed when a message is received on the corresponding topics */
  private topicsConfig: Map<string, (message: PropagatedMessage<any>, ctx: PropagationContext) => Promise<void> | void>;

  /** Maximum seen messages a topic can have */
  private MAX_SEEN_MSGS_PER_TOPIC: number;

  /** Messages Time to live in minutes */
  private MSGS_TTL_MIN: number;

  /** Maximum message bytes allowed for a message */
  private MAX_MSG_BYTES: number;

  constructor(
    node: Libp2p,
    private readonly metrics: GossipSubPropagationMetrics,
    maxSeenMsgsPerTopic = 10_000,
    msgsTtlMin = 10 * 60 * 1000,
    maxMsgBytes = 64 * 1024,
  ) {
    this.node = node;
    this.pubsub = this.node.services.pubsub as GossipSub;
    this.topicsConfig = new Map();
    this.seenMessages = new Map();
    this.MAX_SEEN_MSGS_PER_TOPIC = maxSeenMsgsPerTopic;
    this.MSGS_TTL_MIN = msgsTtlMin;
    this.MAX_MSG_BYTES = maxMsgBytes;

    this.gossipListener = (event: CustomEvent<Message>) => {
      const topic = event.detail.topic;
      const data = event.detail.data;
      const handler = this.topicsConfig.get(topic);

      if (!handler || !data || data.length > this.MAX_MSG_BYTES) return;

      try {
        const msg = JSON.parse(uint8ArrayToString(data)) as PropagatedMessage<any>;

        if (!msg || !msg.id) return;
        if (this.seenMessages.has(topic) && this.seenMessages.get(topic)?.has(msg.id)) {
          logger.trace('Ignoring already seen message');
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
        if (handler)
          handler(msg, {
            from: (event.detail as SignedMessage).from,
            receivedAt: Date.now(),
            topic,
          });
      } catch (error: unknown) {
        logger.warn('Error occured while receiving a data propagation message');
        logger.debug(error);
      }
      this.metrics.messageReceived(topic);
    };

    this.pubsub.addEventListener('message', this.gossipListener);
  }

  private initializeSeenCache(): LRUCache<string, true> {
    return new LRUCache({
      max: this.MAX_SEEN_MSGS_PER_TOPIC,
      ttl: this.MSGS_TTL_MIN,
    });
  }

  async publish<T>(topic: string, message: PropagatedMessage<T>): Promise<void> {
    const handler = this.topicsConfig.get(topic);
    if (!handler) throw new Error(`Cannot publish to unregistered topic "${topic}"`);

    const data = uint8ArrayFromString(JSON.stringify(message));
    await this.pubsub.publish(topic, data);
    this.metrics.messagePublished(topic);
  }

  subscribe<T>(
    topic: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => Promise<void> | void,
  ): void {
    this.pubsub.subscribe(topic);
    this.topicsConfig.set(topic, handler);
  }

  unsubscribe(topic: string, purgeData = false): void {
    this.pubsub.unsubscribe(topic);
    this.topicsConfig.delete(topic);
    if (purgeData) this.seenMessages.delete(topic);
  }

  stop(): void {
    this.pubsub.removeEventListener('message', this.gossipListener);
    this.topicsConfig.keys().forEach((key) => this.unsubscribe(key));
  }

  clearMessages(topic?: string): void {
    if (topic) return this.seenMessages.get(topic)?.clear();
    this.seenMessages.clear();
  }

  getSeenMessages(): ReadonlyMap<string, LRUCache<string, true>> {
    return new Map(this.seenMessages);
  }
}
