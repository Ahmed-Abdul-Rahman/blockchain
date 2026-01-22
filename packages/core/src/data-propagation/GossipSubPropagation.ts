import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { Libp2p, Message, SignedMessage } from '@libp2p/interface';
import { LRUCache } from 'lru-cache';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { DataPropagationInterface } from './DataPropagationInterface';
import { PropagatedMessage, PropagationContext } from './types';

export class GossipSubPropagation<T> implements DataPropagationInterface<PropagatedMessage<T>> {
  private node: Libp2p;

  private pubsub: GossipSub;

  /**Map to store seen messages to avoid deduplication of data propagation */
  private seenMessages: Map<string, LRUCache<string, true>>;

  /** Listener for listening to gossip messages */
  private gossipListener: (event: CustomEvent<Message>) => void;

  /** Handler function that gets executed when a message is received on the corresponding topics */
  private topicsHandler: Map<string, (message: PropagatedMessage<T>, ctx: PropagationContext) => void>;

  /** Maximum seen messages a topic can have */
  private MAX_SEEN_MSGS_PER_TOPIC: number;

  /** Messages Time to live in minutes */
  private MSGS_TTL_MIN: number;

  /** Maximum message bytes allowed for a message */
  private MAX_MSG_BYTES: number;

  constructor(node: Libp2p, maxSeenMsgsPerTopic = 10_000, msgsTtlMin = 10 * 60 * 1000, maxMsgBytes = 64 * 1024) {
    this.node = node;
    this.pubsub = this.node.services.pubsub as GossipSub;
    this.topicsHandler = new Map();
    this.seenMessages = new Map();
    this.MAX_SEEN_MSGS_PER_TOPIC = maxSeenMsgsPerTopic;
    this.MSGS_TTL_MIN = msgsTtlMin;
    this.MAX_MSG_BYTES = maxMsgBytes;

    this.gossipListener = (event: CustomEvent<Message>) => {
      const topic = event.detail.topic;
      const data = event.detail.data;
      const handler = this.topicsHandler.get(topic);

      if (!handler || !data || data.length > this.MAX_MSG_BYTES) return;

      try {
        const msg = JSON.parse(uint8ArrayToString(data)) as PropagatedMessage<T>;

        if (!msg || !msg.id) return;
        if (this.seenMessages.has(topic) && this.seenMessages.get(topic)?.has(msg.id)) {
          logger.info('Ignoring already seen message');
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
    };

    this.pubsub.addEventListener('message', this.gossipListener);
  }

  private initializeSeenCache(): LRUCache<string, true> {
    return new LRUCache({
      max: this.MAX_SEEN_MSGS_PER_TOPIC,
      ttl: this.MSGS_TTL_MIN,
    });
  }

  async publish(topic: string, message: PropagatedMessage<T>): Promise<void> {
    const data = uint8ArrayFromString(JSON.stringify(message));
    await this.pubsub.publish(topic, data);
  }

  async subscribe(
    topic: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => void,
  ): Promise<void> {
    this.pubsub.subscribe(topic);
    this.topicsHandler.set(topic, handler);
  }

  async unsubscribe(topic: string, purgeData = false): Promise<void> {
    this.pubsub.unsubscribe(topic);
    this.topicsHandler.delete(topic);
    if (purgeData) this.seenMessages.delete(topic);
  }

  async stop(): Promise<void> {
    this.seenMessages.clear();
    this.pubsub.removeEventListener('message', this.gossipListener);
  }

  getSeenMessages(): ReadonlyMap<string, LRUCache<string, true>> {
    return new Map(this.seenMessages);
  }
}
