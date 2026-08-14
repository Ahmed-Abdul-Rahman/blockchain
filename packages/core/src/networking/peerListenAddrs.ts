import type { Libp2p, PeerId } from '@libp2p/interface';

/**
 * Listen multiaddrs Identify advertised for a remote peer.
 * Falls back to the connection remote addr when the peerstore is empty
 * (Identify may not have completed yet).
 */
export const peerListenAddrs = async (
  node: Pick<Libp2p, 'peerStore'>,
  peerId: PeerId,
  fallback: readonly string[],
): Promise<string[]> => {
  try {
    const record = await node.peerStore.get(peerId);
    const addrs = record.addresses.map((entry) => entry.multiaddr.toString());
    if (addrs.length > 0) return addrs;
  } catch {
    // Peerstore miss is expected before Identify completes.
  }
  return [...fallback];
};
