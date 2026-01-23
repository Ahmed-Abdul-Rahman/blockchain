import { PeerExchangeServiceMetrics } from '../interfaces/PeerExchangeServiceMetrics';

export class NoopPeerExchangeMetrics implements PeerExchangeServiceMetrics {
  readonly namespace = 'peer_exchange';

  exchangeRequested(): void {}
  exchangeResponded(): void {}
  peerDiscovered(): void {}
  peerAccepted(): void {}
  peerRejected(reason: 'duplicate' | 'invalid' | 'low_score'): void {}
}
