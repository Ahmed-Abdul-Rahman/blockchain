import { portableRoomReplicationStrategies } from '@dechat/core';
import { createNode } from '@dechat/core/node';
import { ChatClient } from './ChatClient';
import { CreateChatClientOptions, chatClientFromHandle } from './createChatClient';
import { parseIdentitySeed } from './identity/identitySeed';

/**
 * Node chat client — TCP (+ WS if configured) with in-memory replica store by default.
 */
export const createChatClient = async (options: CreateChatClientOptions): Promise<ChatClient> => {
  const handle = await createNode(options.infoHash, parseIdentitySeed(options.nodeSeed), {
    config: options.config,
    strategies: portableRoomReplicationStrategies(),
  });
  return chatClientFromHandle(handle);
};
