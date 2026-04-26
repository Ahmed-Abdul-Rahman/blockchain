/**
 * Contract defining how the Transport layer reports P2P events to the Replication Engine.
 */
export interface ReplicationEngineDelegate {
  /**
   * Triggered when a peer passively announces that it has a specific content hash.
   */
  onPeerAnnounced(hash: string, peerId: string, handleAnnounce: () => Promise<void>): Promise<void>;

  /**
   * Triggered when a peer actively requests a content hash from us.
   * Returns the exact bytes if found, or a list of closer routing hops if not found.
   */
  onPeerRequested(
    hash: string,
    peerId: string,
  ): Promise<{ found: true; data: Uint8Array } | { found: false; closestPeers: string[] }>;

  /**
   * Triggered when a peer pushes content to us outside of an active RPC request.
   */
  onPeerDeliveredContent(hash: string, data: Uint8Array, peerId: string): Promise<void>;

  /**
   * Triggered when a peer reports an error outside of an active RPC request.
   */
  onPeerReportedError(hash: string, reason: string, closestPeers: string[] | undefined, peerId: string): Promise<void>;
}
