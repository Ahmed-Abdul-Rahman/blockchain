/** Localhost hybrid listen — tests and loopback recipes. */
export const LOCAL_HYBRID_LISTEN_ADDRS: readonly string[] = ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'];

/** LAN hybrid listen — Node bootstrap that other machines / browsers can dial. */
export const LAN_HYBRID_LISTEN_ADDRS: readonly string[] = ['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/tcp/0/ws'];

/**
 * Bootstrap listen recipe. Empty or omitted addrs fall back to LAN hybrid (TCP + /ws).
 */
export const resolveBootstrapListenAddrs = (configured: readonly string[] | undefined): string[] =>
  configured !== undefined && configured.length > 0 ? [...configured] : [...LAN_HYBRID_LISTEN_ADDRS];

/** First TCP listen multiaddr that is not a WebSocket listener. */
export const pickTcpListenAddr = (addrs: readonly string[]): string => {
  const tcp = addrs.find((addr) => addr.includes('/tcp/') && !addr.includes('/ws'));
  if (!tcp) {
    throw new Error(`No TCP listen multiaddr. Got: ${addrs.join(', ') || '(none)'}`);
  }
  return tcp;
};

/** First listen multiaddr that includes `/ws` or `/wss`. */
export const pickWsListenAddr = (addrs: readonly string[]): string => {
  const ws = addrs.find((addr) => addr.includes('/ws'));
  if (!ws) {
    throw new Error(`No /ws listen multiaddr (browser clients need this). Got: ${addrs.join(', ') || '(none)'}`);
  }
  return ws;
};

/**
 * Browser clients must dial a WebSocket bootstrap. Plain TCP multiaddrs are not reachable
 * from a browser. HTTPS pages need `/wss` (TLS at a reverse proxy) — this helper accepts both.
 */
export const requireWsBootstrapPeers = (peers: readonly string[]): readonly string[] => {
  if (peers.length === 0) {
    throw new Error(
      'Browser chat clients require at least one bootstrap multiaddr (typically a Node peer /ws address).',
    );
  }
  if (!peers.some((peer) => peer.includes('/ws'))) {
    throw new Error(
      'Browser chat clients must dial a /ws or /wss bootstrap multiaddr. TCP-only bootstrap is Node-only.',
    );
  }
  return peers;
};
