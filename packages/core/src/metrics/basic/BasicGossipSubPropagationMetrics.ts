import { GossipSubPropagationMetrics } from '../interfaces/GossipSubPropagationMetrics';
import { BaseMetrics } from './BaseMetrics';

export class BasicGossipSubPropagationMetrics extends BaseMetrics implements GossipSubPropagationMetrics {
  readonly namespace = 'gossipsub_propagation';

  messagePublished(topic: string): void {
    this.inc('message_published');
    this.inc(`message_published_topic:${topic}`);
  }

  messageReceived(topic: string): void {
    this.inc('message_received');
    this.inc(`message_received_topic:${topic}`);
  }

  messageDropped(reason: string): void {
    this.inc('message_dropped');
    this.inc(`message_dropped_reason:${reason}`);
  }
}
