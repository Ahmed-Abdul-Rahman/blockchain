import { PeerRegistryMetrics } from '../interfaces/PeerRegistryMetrics';

export class NoopPeerRegistryMetrics implements PeerRegistryMetrics {
  readonly namespace = 'peer_registry';

  peerAdded(): void {}
  peerRemoved(reason: 'expired' | 'blacklisted' | 'manual'): void {}
  registrySize(size: number): void {}
}
