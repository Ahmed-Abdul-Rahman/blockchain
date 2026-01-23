export interface PeerExchangeServiceMetrics {
  readonly namespace: 'peer_exchange';

  exchangeRequested(): void;

  exchangeResponded(): void;

  peerDiscovered(): void;

  peerAccepted(): void;

  peerRejected(reason: 'duplicate' | 'invalid' | 'low_score'): void;
}
