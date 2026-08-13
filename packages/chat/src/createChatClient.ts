import type { DeChatConfig, DeChatNodeHandle } from '@dechat/core';
import type { PartialDeep } from 'type-fest';
import { ChatClient, ChatClientImpl } from './ChatClient';

export interface CreateChatClientOptions {
  readonly infoHash: string;
  readonly nodeSeed: string;
  readonly config?: PartialDeep<DeChatConfig>;
}

export const chatClientFromHandle = (handle: DeChatNodeHandle): ChatClient => new ChatClientImpl(handle);
