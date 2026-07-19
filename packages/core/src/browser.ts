import { PartialDeep } from 'type-fest';
import type { DeChatConfig } from './config/types';
import { createDeChatNode } from './createDeChatNode';
import { createBrowserPlatformStack } from './platform/createBrowserPlatformStack';
import type { DeChatStrategies } from './types';

export interface CreateBrowserNodeOptions {
  readonly config?: PartialDeep<DeChatConfig>;
  readonly strategies?: DeChatStrategies;
}

/**
 * Browser facade — WebSockets + bootstrap platform stack.
 *
 * Required: `config.network.bootstrapPeers` with at least one multiaddr reachable
 * from the browser (typically a Node peer advertising `/ws`).
 *
 * Does not import `@libp2p/tcp`, `@libp2p/mdns`, or LevelDB.
 */
export const createBrowserNode = (
  infoHash: string,
  nodeSeed: string,
  options?: CreateBrowserNodeOptions,
): ReturnType<typeof createDeChatNode> =>
  createDeChatNode(infoHash, nodeSeed, {
    config: {
      ...options?.config,
      platform: { kind: 'browser' },
      discovery: {
        ...options?.config?.discovery,
        enableMdns: false,
      },
      network: {
        ...options?.config?.network,
        listenAddrs: options?.config?.network?.listenAddrs ?? [],
        bootstrapPeers: options?.config?.network?.bootstrapPeers ?? [],
      },
    },
    strategies: options?.strategies,
    platformStack: (config) => createBrowserPlatformStack({ config }),
  });
