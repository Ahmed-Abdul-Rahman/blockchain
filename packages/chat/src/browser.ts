import { createBrowserNode, indexedDbReplicaStore, portableRoomReplicationStrategies } from '@dechat/core/browser';
import { ChatClient } from './ChatClient';
import { CreateChatClientOptions, chatClientFromHandle } from './createChatClient';

/**
 * Browser chat client — WebSocket dial + IndexedDB store. Requires bootstrapPeers.
 */
export const createChatClient = async (options: CreateChatClientOptions): Promise<ChatClient> => {
  const handle = await createBrowserNode(options.infoHash, options.nodeSeed, {
    config: options.config,
    strategies: portableRoomReplicationStrategies(indexedDbReplicaStore()),
  });
  return chatClientFromHandle(handle);
};
