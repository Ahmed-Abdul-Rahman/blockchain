import { GossipSubPropagationMetrics } from '../interfaces/GossipSubPropagationMetrics';

export class NoopGossipMetrics implements GossipSubPropagationMetrics {
  readonly namespace = 'gossipsub_propagation';

  messagePublished() {}
  messageReceived() {}
  messageDropped() {}
}
