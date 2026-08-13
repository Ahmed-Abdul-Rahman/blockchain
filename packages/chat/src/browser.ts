import { createBrowserNode, indexedDbReplicaStore, portableRoomReplicationStrategies } from '@dechat/core/browser';
import { requireWsBootstrapPeers } from './bootstrap/listenAddrs';
import { ChatClient } from './ChatClient';
import { CreateChatClientOptions, chatClientFromHandle } from './createChatClient';
import { parseIdentitySeed } from './identity/identitySeed';

/**
 * Browser chat client — WebSocket dial + IndexedDB store. Requires /ws bootstrapPeers.
 */
export const createChatClient = async (options: CreateChatClientOptions): Promise<ChatClient> => {
  const bootstrapPeers = requireWsBootstrapPeers(options.config?.network?.bootstrapPeers ?? []);
  const handle = await createBrowserNode(options.infoHash, parseIdentitySeed(options.nodeSeed), {
    config: {
      ...options.config,
      network: {
        ...options.config?.network,
        bootstrapPeers: [...bootstrapPeers],
      },
    },
    strategies: portableRoomReplicationStrategies(indexedDbReplicaStore()),
  });
  return chatClientFromHandle(handle);
};
