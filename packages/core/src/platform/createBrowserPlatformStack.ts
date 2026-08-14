import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { webSockets } from '@libp2p/websockets';
import type { DeChatConfig } from '../config/types';
import type { Libp2pPlatformStack } from './types';

export interface CreateBrowserPlatformStackOptions {
  /** Resolved DeChat config — browser profile requires non-empty bootstrapPeers. */
  readonly config: DeChatConfig;
}

/**
 * Browser adapter for {@link Libp2pPlatformStack}.
 * WebSockets dial + bootstrap discovery only — no TCP, no mDNS.
 *
 * Apps must pass at least one bootstrap multiaddr reachable from the browser
 * (typically a Node peer listening on `/ws`, e.g. `/ip4/.../tcp/.../ws/p2p/...`).
 */
export const createBrowserPlatformStack = ({ config }: CreateBrowserPlatformStackOptions): Libp2pPlatformStack => {
  if (config.network.bootstrapPeers.length === 0) {
    throw new Error(
      'Browser platform stack requires network.bootstrapPeers — browsers cannot discover peers via mDNS/TCP listen.',
    );
  }

  return {
    // `filters.all` is the transport default; private/loopback `/ws` is allowed via
    // `denyDialMultiaddr` in createDeChatNode (js-libp2p's browser gater would deny them).
    transports: [webSockets()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    peerDiscovery: [bootstrap({ list: [...config.network.bootstrapPeers] })],
    listenAddrs: config.network.listenAddrs,
  };
};
