import { logger } from '@dechat/common';
import type { DeChatNodeHandle, RoomContentApplied, RoomScopeInterface } from '@dechat/core';
import { generateRandomUUID } from '@dechat/crypto';
import {
  ChatEvent,
  ChatMessageEnvelope,
  ChatMessageView,
  isChatMessageEnvelope,
  isTombstoneEnvelope,
  MessageBody,
} from './domain/types';
import { projectRoomHistory, StoredEnvelope } from './projection/projectRoomHistory';

export interface ChatClient {
  readonly peerId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  sendMessage(roomId: string, body: MessageBody): Promise<string>;
  getHistory(roomId: string): Promise<readonly ChatMessageView[]>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  /** Listening multiaddrs — used by bootstrap peers and interop tests. */
  getListenAddrs(): readonly string[];
  /** Auth-gated registry members (verified peers). */
  getVerifiedPeers(): readonly string[];
}

/**
 * Application facade over a DeChat node with room-scoped replication.
 */
export class ChatClientImpl implements ChatClient {
  private readonly scope: RoomScopeInterface;
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  private unsubscribeScope: (() => void) | undefined;

  constructor(private readonly handle: DeChatNodeHandle) {
    const scope = handle.components.strategies.roomScope;
    if (!scope) {
      throw new Error('ChatClient requires room-scoped replication (portableRoomReplicationStrategies).');
    }
    this.scope = scope;
  }

  get peerId(): string {
    return this.handle.components.libp2p.peerId.toString();
  }

  async start(): Promise<void> {
    await this.handle.start();
    this.unsubscribeScope = this.scope.subscribe((applied) => {
      this.dispatchApplied(applied);
    });
  }

  async stop(): Promise<void> {
    this.unsubscribeScope?.();
    this.unsubscribeScope = undefined;
    this.listeners.clear();
    await this.handle.stop();
  }

  async joinRoom(roomId: string): Promise<void> {
    await this.scope.joinRoom(roomId);
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.scope.leaveRoom(roomId);
  }

  async sendMessage(roomId: string, body: MessageBody): Promise<string> {
    if (typeof body.text !== 'string' || body.text.length === 0) {
      throw new Error('ChatClient.sendMessage requires a non-empty text body.');
    }
    const envelope: ChatMessageEnvelope = {
      type: 'chat_message',
      roomId,
      messageId: generateRandomUUID(),
      senderPeerId: this.peerId,
      timestamp: Date.now(),
      body,
    };
    return this.scope.produce(roomId, envelope);
  }

  async getHistory(roomId: string): Promise<readonly ChatMessageView[]> {
    const store = this.handle.components.strategies.replicaStore;
    if (!store) {
      throw new Error('ChatClient.getHistory requires a replicaStore strategy.');
    }
    const hashes = this.scope.getRoomHashes(roomId);
    const records: StoredEnvelope[] = [];
    for (const hash of hashes) {
      const bytes = await store.get(hash);
      if (!bytes) continue;
      try {
        const decoded: unknown = this.handle.components.serializer.deserialize(bytes);
        if (isChatMessageEnvelope(decoded) || isTombstoneEnvelope(decoded)) {
          if (String(decoded.roomId) !== roomId) continue;
          records.push({ hash, envelope: decoded });
        }
      } catch (err) {
        logger.debug('[ChatClient] Skipping undecodable replica', (err as Error).message);
      }
    }
    return projectRoomHistory(records);
  }

  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getListenAddrs(): readonly string[] {
    return this.handle.components.libp2p.getMultiaddrs().map((addr) => addr.toString());
  }

  getVerifiedPeers(): readonly string[] {
    return this.handle.components.peerRegistry.getPeers();
  }

  private dispatchApplied(applied: RoomContentApplied): void {
    try {
      const decoded: unknown = this.handle.components.serializer.deserialize(applied.bytes);
      if (isChatMessageEnvelope(decoded)) {
        const event: ChatEvent = {
          type: 'message',
          roomId: applied.roomId,
          message: {
            hash: applied.hash,
            roomId: String(decoded.roomId),
            messageId: decoded.messageId,
            senderPeerId: decoded.senderPeerId,
            timestamp: decoded.timestamp,
            body: decoded.body,
          },
        };
        for (const listener of this.listeners) listener(event);
        return;
      }
      if (isTombstoneEnvelope(decoded)) {
        const event: ChatEvent = {
          type: 'tombstone',
          roomId: applied.roomId,
          hash: applied.hash,
          targetHash: decoded.targetHash,
        };
        for (const listener of this.listeners) listener(event);
      }
    } catch (err) {
      logger.debug('[ChatClient] Ignoring non-chat applied content', (err as Error).message);
    }
  }
}
