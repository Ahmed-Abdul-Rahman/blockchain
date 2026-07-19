import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import type { DeChatConfig } from '../config/types';
import type { Libp2pPlatformStack } from './types';

export interface CreateNodePlatformStackOptions {
  /** Resolved DeChat config — discovery + listen/bootstrap drive the stack. */
  readonly config: DeChatConfig;
}

/**
 * Node adapter for {@link Libp2pPlatformStack}.
 * Preserves historical behaviour: TCP listen, optional mDNS, optional bootstrap.
 * WebSockets transport is added only when a listen addr includes `/ws` (hybrid bootstrap).
 */
export const createNodePlatformStack = ({ config }: CreateNodePlatformStackOptions): Libp2pPlatformStack => {
  const peerDiscovery: Libp2pPlatformStack['peerDiscovery'] = [];

  if (config.discovery.enableMdns) {
    peerDiscovery.push(mdns({ interval: 10e3 }));
  }

  if (config.network.bootstrapPeers.length > 0) {
    peerDiscovery.push(bootstrap({ list: [...config.network.bootstrapPeers] }));
  }

  const wantsWebSockets = config.network.listenAddrs.some((addr) => addr.includes('/ws'));

  return {
    transports: wantsWebSockets ? [tcp(), webSockets()] : [tcp()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    peerDiscovery,
    listenAddrs: config.network.listenAddrs,
  };
};
