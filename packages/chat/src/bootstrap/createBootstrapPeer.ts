import { ChatClient } from '../ChatClient';
import { CreateChatClientOptions } from '../createChatClient';
import { createChatClient } from '../node';
import { resolveBootstrapListenAddrs } from './listenAddrs';

/**
 * Node bootstrap peer: TCP + WebSocket listen so Node clients and browsers can dial.
 * mDNS is off by default — callers pass the printed multiaddr as `bootstrapPeers`.
 */
export const createBootstrapPeer = async (options: CreateChatClientOptions): Promise<ChatClient> => {
  const listenAddrs = resolveBootstrapListenAddrs(options.config?.network?.listenAddrs);
  return createChatClient({
    infoHash: options.infoHash,
    nodeSeed: options.nodeSeed,
    config: {
      ...options.config,
      discovery: {
        enableMdns: false,
        ...options.config?.discovery,
      },
      network: {
        bootstrapPeers: [],
        ...options.config?.network,
        listenAddrs,
      },
    },
  });
};
