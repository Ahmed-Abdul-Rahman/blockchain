export interface GossipSubPropagationMetrics {
  readonly namespace: 'gossipsub_propagation';

  messagePublished(topic: string): void;

  messageReceived(topic: string): void;

  messageDropped(reason: 'duplicate' | 'invalid_signature' | 'oversize' | 'malformed' | 'unauthorized'): void;
}
