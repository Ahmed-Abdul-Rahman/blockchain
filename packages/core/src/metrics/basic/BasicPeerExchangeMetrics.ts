import { PeerExchangeServiceMetrics } from '../interfaces/PeerExchangeServiceMetrics';
import { BaseMetrics } from './BaseMetrics';

export class BasicPeerExchangeMetrics extends BaseMetrics implements PeerExchangeServiceMetrics {
  readonly namespace = 'peer_exchange';

  exchangeRequested(): void {
    this.inc('exchange_requested');
  }

  exchangeResponded(): void {
    this.inc('exchange_responded');
  }

  peerDiscovered(): void {
    this.inc('peer_discovered');
  }

  peerAccepted(): void {
    this.inc('peer_accepted');
  }

  peerRejected(reason: string): void {
    this.inc('peer_rejected');
    this.inc(`peer_rejected_reason:${reason}`);
  }
}
