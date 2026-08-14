import { logger } from '@dechat/common';
import type { DeChatNodeHandle, RoomContentApplied, RoomScopeInterface } from '@dechat/core';
import { generateRandomUUID } from '@dechat/crypto';
import {
  ChatEvent,
  ChatMessageView,
  DecryptedChatRecord,
  EncryptedChatEnvelope,
  isEncryptedChatEnvelope,
  isTombstoneEnvelope,
  MessageBody,
} from './domain/types';
import { decryptChatBody, encryptChatBody } from './e2ee/encryptChatBody';
import { RoomKeyExchange } from './e2ee/RoomKeyExchange';
import { RoomKeyRing } from './e2ee/RoomKeyRing';
import { parseDisplayName } from './identity/displayName';
import { projectRoomHistory, StoredEnvelope } from './projection/projectRoomHistory';

export interface ChatClient {
  readonly peerId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  isMember(roomId: string): boolean;
  setDisplayName(name: string): void;
  getDisplayName(): string | undefined;
  sendMessage(roomId: string, body: MessageBody): Promise<string>;
  rotateRoomKey(roomId: string): Promise<void>;
  getHistory(roomId: string): Promise<readonly ChatMessageView[]>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  /** Listening multiaddrs — used by bootstrap peers and interop tests. */
  getListenAddrs(): readonly string[];
  /** Auth-gated registry members (verified peers). */
  getVerifiedPeers(): readonly string[];
}

/**
 * Application facade over a DeChat node with room-scoped replication and body E2EE.
 */
export class ChatClientImpl implements ChatClient {
  private readonly scope: RoomScopeInterface;
  private readonly nodeKey: { secret: Uint8Array; pub: Uint8Array };
  private readonly keyRing = new RoomKeyRing();
  private readonly keyExchange: RoomKeyExchange;
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  private unsubscribeScope: (() => void) | undefined;
  private displayName: string | undefined;

  constructor(private readonly handle: DeChatNodeHandle) {
    const scope = handle.components.strategies.roomScope;
    if (!scope) {
      throw new Error('ChatClient requires room-scoped replication (portableRoomReplicationStrategies).');
    }
    const nodeKey = handle.components.config?.peerAuthenticator?.nodeKey;
    if (!nodeKey) {
      throw new Error('ChatClient requires peerAuthenticator.nodeKey for E2EE signatures.');
    }
    const direct = handle.components.strategies.direct;
    if (!direct) {
      throw new Error('ChatClient requires a direct propagation strategy for room-key exchange.');
    }
    this.scope = scope;
    this.nodeKey = nodeKey;
    this.keyExchange = new RoomKeyExchange({
      ring: this.keyRing,
      direct,
      selfPeerId: handle.components.libp2p.peerId.toString(),
      getVerifiedPeers: () => handle.components.peerRegistry.getPeers(),
      isMember: (roomId) => this.scope.isMember(roomId),
    });
  }

  get peerId(): string {
    return this.handle.components.libp2p.peerId.toString();
  }

  async start(): Promise<void> {
    await this.handle.start();
    this.keyExchange.start();
    this.unsubscribeScope = this.scope.subscribe((applied) => {
      this.dispatchApplied(applied);
    });
  }

  async stop(): Promise<void> {
    this.unsubscribeScope?.();
    this.unsubscribeScope = undefined;
    this.listeners.clear();
    this.keyRing.discardAll();
    await this.keyExchange.stop();
    await this.handle.stop();
  }

  async joinRoom(roomId: string): Promise<void> {
    await this.scope.joinRoom(roomId);
    await this.keyExchange.ensureKey(roomId);
  }

  async leaveRoom(roomId: string): Promise<void> {
    this.keyRing.discard(roomId);
    await this.scope.leaveRoom(roomId);
  }

  isMember(roomId: string): boolean {
    return this.scope.isMember(roomId);
  }

  setDisplayName(name: string): void {
    this.displayName = parseDisplayName(name);
  }

  getDisplayName(): string | undefined {
    return this.displayName;
  }

  async rotateRoomKey(roomId: string): Promise<void> {
    if (!this.scope.isMember(roomId)) {
      throw new Error(`ChatClient.rotateRoomKey requires joining "${roomId}" first.`);
    }
    this.keyRing.rotate(roomId);
    await this.keyExchange.offerToPeers(roomId);
  }

  async sendMessage(roomId: string, body: MessageBody): Promise<string> {
    if (typeof body.text !== 'string' || body.text.length === 0) {
      throw new Error('ChatClient.sendMessage requires a non-empty text body.');
    }
    if (!this.scope.isMember(roomId)) {
      throw new Error(`ChatClient.sendMessage requires joining "${roomId}" first.`);
    }
    const material = this.keyRing.current(roomId);
    if (!material) {
      throw new Error(`ChatClient.sendMessage has no room key for "${roomId}". Join the room first.`);
    }
    const envelope = await encryptChatBody({
      roomId,
      messageId: generateRandomUUID(),
      senderPeerId: this.peerId,
      senderPublicKey: this.nodeKey.pub,
      senderSecret: this.nodeKey.secret,
      timestamp: Date.now(),
      keyEpoch: material.epoch,
      roomKey: material.key,
      body,
      displayName: this.displayName,
    });
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
        if (isTombstoneEnvelope(decoded)) {
          if (String(decoded.roomId) !== roomId) continue;
          records.push({ hash, envelope: decoded });
          continue;
        }
        if (!isEncryptedChatEnvelope(decoded) || String(decoded.roomId) !== roomId) continue;
        const projected = await this.toDecryptedRecord(decoded);
        if (projected) records.push({ hash, envelope: projected });
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
    void this.dispatchAppliedAsync(applied);
  }

  private async dispatchAppliedAsync(applied: RoomContentApplied): Promise<void> {
    try {
      const decoded: unknown = this.handle.components.serializer.deserialize(applied.bytes);
      if (isEncryptedChatEnvelope(decoded)) {
        const projected = await this.toDecryptedRecord(decoded);
        if (!projected) return;
        const event: ChatEvent = {
          type: 'message',
          roomId: applied.roomId,
          message: {
            hash: applied.hash,
            roomId: projected.roomId,
            messageId: projected.messageId,
            senderPeerId: projected.senderPeerId,
            timestamp: projected.timestamp,
            body: projected.body,
            untrustedDisplayName: projected.displayName,
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

  private async toDecryptedRecord(envelope: EncryptedChatEnvelope): Promise<DecryptedChatRecord | undefined> {
    const key = this.keyRing.get(envelope.roomId, envelope.keyEpoch);
    if (!key) return undefined;
    const plain = await decryptChatBody(envelope, key);
    if (!plain) return undefined;
    return {
      type: 'chat_message' as const,
      roomId: envelope.roomId,
      messageId: envelope.messageId,
      senderPeerId: envelope.senderPeerId,
      timestamp: envelope.timestamp,
      body: plain.body,
      displayName: plain.displayName,
    };
  }
}
