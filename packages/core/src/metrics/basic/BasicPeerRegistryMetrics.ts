import { PeerRegistryMetrics } from '../interfaces/PeerRegistryMetrics';
import { BaseMetrics } from './BaseMetrics';

export class BasicPeerRegistryMetrics extends BaseMetrics implements PeerRegistryMetrics {
  readonly namespace = 'peer_registry';

  peerAdded(): void {
    this.inc('peer_added');
  }

  peerRemoved(reason: string): void {
    this.inc('peer_removed');
    this.inc(`peer_removed_reason:${reason}`);
  }

  peerScoreUpdated(): void {
    this.inc('peer_score_updated');
  }

  registrySize(size: number): void {
    this.setGauge('registry_size', size);
  }
}
