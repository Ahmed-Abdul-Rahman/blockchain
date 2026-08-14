import type { DeChatConfig, DeChatNodeHandle } from '@dechat/core';
import type { PartialDeep } from 'type-fest';
import { ChatClient, ChatClientImpl } from './ChatClient';

export interface CreateChatClientOptions {
  /** Mesh id — partitions this DeChat network; not a room-join credential. */
  readonly infoHash: string;
  /** Identity seed — same value restores the same PeerId. Use {@link generateIdentitySeed}. */
  readonly nodeSeed: string;
  readonly config?: PartialDeep<DeChatConfig>;
}

export const chatClientFromHandle = (handle: DeChatNodeHandle): ChatClient => new ChatClientImpl(handle);
