export interface PeerRegistryMetrics {
  readonly namespace: 'peer_registry';

  peerAdded(): void;

  peerRemoved(reason: 'expired' | 'blacklisted' | 'manual'): void;

  registrySize(size: number): void;
}
