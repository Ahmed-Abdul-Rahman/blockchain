import { logger } from '@dechat/common';
import { isStartable } from '@libp2p/interface';
import { sampleSize } from 'es-toolkit';
import EventEmitter from 'eventemitter3';
import { BroadcastPropagationInterface } from '../../data-propagation/broadcast/BroadcastPropagationInterface';
import { DirectPropagationInterface } from '../../data-propagation/direct/DirectPropagationInterface';
import { PropagatedMessage, PropagationContext } from '../../data-propagation/types';
import { ReplicaStoreInterface } from '../../replica-store/ReplicaStoreInterface';
import { DataSerializer } from '../../shared/types';
import { DeChatComponents, DeChatFactory } from '../../types';
import { ContentHashStrategyInterface } from '../content-hash/types';
import { DataReplicationInterface } from '../DataReplicationInterface';
import { ReplicationEngineDelegate } from '../replication-protocol/ReplicationEngineDelegateInterface';
import { ReplicationProtocolInterface } from '../replication-protocol/ReplicationProtocolInterface';
import { topicBasedContentHashReplication } from '../TopicBasedContentReplication';
import { ContentHash } from '../types';
import { RoomScopeInterface } from './RoomScopeInterface';
import { asRoomId, ROOM_INDEX_PROTOCOL, RoomId, roomTopic } from './roomId';
import { RoomAnnounce, RoomContentApplied, RoomIndexMessage, RoomScopeListener } from './types';

type InnerReplication = DataReplicationInterface & Partial<ReplicationEngineDelegate>;

/**
 * Confines announce/pull/store indexing to joined rooms while delegating
 * persist and REQUEST/CONTENT to an inner replication strategy (ADR-0005).
 */
export class RoomScopedReplication implements DataReplicationInterface, RoomScopeInterface, ReplicationEngineDelegate {
  readonly replicationProtocol: ReplicationProtocolInterface;

  private readonly inner: InnerReplication;
  private readonly hasher: ContentHashStrategyInterface;
  private readonly storage: ReplicaStoreInterface;
  private readonly broadcast: BroadcastPropagationInterface;
  private readonly direct: DirectPropagationInterface;
  private readonly serializer: DataSerializer;
  private readonly selfPeerId: string;
  private readonly getKnownPeers: () => string[];

  private readonly membership = new Set<RoomId>();
  private readonly roomHashes = new Map<RoomId, Set<ContentHash>>();
  private readonly hashToRoom = new Map<ContentHash, RoomId>();
  private readonly events = new EventEmitter<{ applied: [RoomContentApplied] }>();

  private started = false;

  private readonly boundAnnounceHandler = (
    message: PropagatedMessage<RoomAnnounce>,
    ctx?: PropagationContext,
  ): void => {
    this.handleRoomAnnounce(message, ctx).catch((err) =>
      logger.error(`[RoomScopedReplication] Room announce handler failed: ${(err as Error).message}`),
    );
  };

  private readonly boundIndexHandler = (
    message: PropagatedMessage<RoomIndexMessage>,
    ctx?: PropagationContext,
  ): void => {
    this.handleIndexMessage(message, ctx).catch((err) =>
      logger.error(`[RoomScopedReplication] Room index handler failed: ${(err as Error).message}`),
    );
  };

  constructor(components: DeChatComponents, inner: InnerReplication) {
    if (!components.strategies.contentHasher) {
      throw new Error('[RoomScopedReplication] requires a contentHasher strategy.');
    }
    if (!components.strategies.replicaStore) {
      throw new Error('[RoomScopedReplication] requires a replicaStore strategy.');
    }
    if (!components.strategies.broadcast) {
      throw new Error('[RoomScopedReplication] requires a broadcast strategy.');
    }
    if (!components.strategies.direct) {
      throw new Error('[RoomScopedReplication] requires a direct strategy.');
    }

    this.inner = inner;
    this.replicationProtocol = inner.replicationProtocol;
    this.hasher = components.strategies.contentHasher;
    this.storage = components.strategies.replicaStore;
    this.broadcast = components.strategies.broadcast;
    this.direct = components.strategies.direct;
    this.serializer = components.serializer;
    this.selfPeerId = components.libp2p.peerId.toString();
    this.getKnownPeers = () => components.peerRegistry.getPeers();
  }

  public async start(): Promise<void> {
    if (this.started) return;
    if (isStartable(this.inner)) await this.inner.start();
    this.replicationProtocol.setDelegate(this);
    this.direct.onReceive(ROOM_INDEX_PROTOCOL, this.boundIndexHandler);
    await this.rebuildIndexFromStore();
    this.started = true;
    logger.info('[RoomScopedReplication] Started');
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.direct.unhandleProtocol(ROOM_INDEX_PROTOCOL);
    for (const roomId of [...this.membership]) {
      await this.broadcast.unsubscribe(roomTopic(roomId), this.boundAnnounceHandler);
    }
    this.membership.clear();
    if (isStartable(this.inner)) await this.inner.stop();
    logger.info('[RoomScopedReplication] Stopped');
  }

  public async joinRoom(roomIdInput: RoomId | string): Promise<void> {
    const roomId = asRoomId(String(roomIdInput));
    if (this.membership.has(roomId)) return;
    this.membership.add(roomId);
    this.ensureRoomSet(roomId);
    await this.broadcast.subscribe(roomTopic(roomId), this.boundAnnounceHandler);
    await this.requestRoomIndexFromPeers(roomId);
    logger.debug(`[RoomScopedReplication] Joined room ${roomId}`);
  }

  public async leaveRoom(roomIdInput: RoomId | string): Promise<void> {
    const roomId = asRoomId(String(roomIdInput));
    if (!this.membership.has(roomId)) return;
    this.membership.delete(roomId);
    await this.broadcast.unsubscribe(roomTopic(roomId), this.boundAnnounceHandler);
    logger.debug(`[RoomScopedReplication] Left room ${roomId}`);
  }

  public isMember(roomIdInput: RoomId | string): boolean {
    return this.membership.has(asRoomId(String(roomIdInput)));
  }

  public getRoomHashes(roomIdInput: RoomId | string): readonly ContentHash[] {
    const roomId = asRoomId(String(roomIdInput));
    return [...(this.roomHashes.get(roomId) ?? [])];
  }

  public subscribe(listener: RoomScopeListener): () => void {
    this.events.on('applied', listener);
    return () => {
      this.events.off('applied', listener);
    };
  }

  public async produce<T>(roomIdInput: RoomId | string, data: T): Promise<ContentHash> {
    const roomId = asRoomId(String(roomIdInput));
    if (!this.membership.has(roomId)) {
      throw new Error(`[RoomScopedReplication] Cannot produce in room "${roomId}" without joining first.`);
    }

    const hash = this.hasher.hash(data);
    if (await this.storage.has(hash)) {
      this.indexHash(roomId, hash);
      return hash;
    }

    const bytes = this.serializer.serialize(data);
    await this.storage.put(hash, bytes);
    this.indexHash(roomId, hash);
    try {
      await this.publishRoomAnnounce(roomId, hash);
    } catch (err) {
      logger.debug(`[RoomScopedReplication] Room announce not gossiped for ${roomId}: ${(err as Error).message}`);
    }
    this.emitApplied(roomId, hash, bytes);
    return hash;
  }

  public async onLocalDataProduced<T>(_data: T): Promise<void> {
    throw new Error('[RoomScopedReplication] Unscoped produce is not allowed. Use produce(roomId, data).');
  }

  public async onRemoteDataReceived<T>(_data: T, _fromPeerId: string): Promise<void> {
    throw new Error(
      '[RoomScopedReplication] Unscoped receive is not allowed. Room announce/index paths apply content.',
    );
  }

  public readonly shouldReplicate = (hash: ContentHash, _fromPeerId?: string): boolean => {
    const roomId = this.hashToRoom.get(hash);
    return roomId !== undefined && this.membership.has(roomId);
  };

  public async requestMissingData<T>(hash: ContentHash, targetPeerId?: string): Promise<T | null> {
    if (!this.shouldReplicate(hash)) return null;
    return this.inner.requestMissingData(hash, targetPeerId);
  }

  public async onPeerAnnounced(hash: string, peerId: string, handleAnnounce: () => Promise<void>): Promise<void> {
    if (!this.shouldReplicate(hash)) return;
    if (this.inner.onPeerAnnounced) {
      await this.inner.onPeerAnnounced(hash, peerId, handleAnnounce);
      return;
    }
    await handleAnnounce();
  }

  public async onPeerRequested(
    hash: string,
    peerId: string,
  ): Promise<{ found: true; data: Uint8Array } | { found: false; closestPeers: string[] }> {
    if (this.inner.onPeerRequested) {
      return this.inner.onPeerRequested(hash, peerId);
    }
    const data = await this.storage.get(hash);
    if (data) return { found: true, data };
    return { found: false, closestPeers: [] };
  }

  public async onPeerDeliveredContent(hash: string, data: Uint8Array, peerId: string): Promise<void> {
    if (!this.shouldReplicate(hash)) return;
    if (this.inner.onPeerDeliveredContent) {
      await this.inner.onPeerDeliveredContent(hash, data, peerId);
    } else {
      await this.storage.put(hash, data);
    }
    const roomId = this.hashToRoom.get(hash);
    if (roomId) this.emitApplied(roomId, hash, data);
  }

  public async onPeerReportedError(
    hash: string,
    reason: string,
    closestPeers: string[] | undefined,
    peerId: string,
  ): Promise<void> {
    if (this.inner.onPeerReportedError) {
      await this.inner.onPeerReportedError(hash, reason, closestPeers, peerId);
    }
  }

  public async syncRoom(roomIdInput: RoomId | string, peerId: string): Promise<void> {
    const roomId = asRoomId(String(roomIdInput));
    if (!this.membership.has(roomId)) {
      throw new Error(`[RoomScopedReplication] Cannot sync room "${roomId}" without joining first.`);
    }
    await this.sendIndexMessage(peerId, { type: 'room_index_request', roomId });
  }

  private async handleRoomAnnounce(message: PropagatedMessage<RoomAnnounce>, ctx?: PropagationContext): Promise<void> {
    const payload = message.payload;
    if (!payload || payload.type !== 'room_announce') return;
    const roomId = asRoomId(payload.roomId);
    if (!this.membership.has(roomId)) return;

    const hash = payload.hash;
    this.indexHash(roomId, hash);
    if (await this.storage.has(hash)) return;

    const from = ctx?.from?.toString() ?? message.from;
    await this.inner.requestMissingData(hash, from);
    const bytes = await this.storage.get(hash);
    if (bytes) this.emitApplied(roomId, hash, bytes);
  }

  private async handleIndexMessage(
    message: PropagatedMessage<RoomIndexMessage>,
    ctx?: PropagationContext,
  ): Promise<void> {
    const payload = message.payload;
    if (!payload || typeof payload !== 'object' || !('type' in payload)) return;
    const from = ctx?.from?.toString() ?? message.from;

    if (payload.type === 'room_index_request') {
      const roomId = asRoomId(payload.roomId);
      const hashes = [...(this.roomHashes.get(roomId) ?? [])];
      if (hashes.length === 0 && !this.membership.has(roomId)) return;
      await this.sendIndexMessage(from, { type: 'room_index', roomId, hashes });
      return;
    }

    if (payload.type === 'room_index') {
      const roomId = asRoomId(payload.roomId);
      if (!this.membership.has(roomId)) return;
      for (const hash of payload.hashes) {
        this.indexHash(roomId, hash);
        if (await this.storage.has(hash)) continue;
        await this.inner.requestMissingData(hash, from);
        const bytes = await this.storage.get(hash);
        if (bytes) this.emitApplied(roomId, hash, bytes);
      }
    }
  }

  private async requestRoomIndexFromPeers(roomId: RoomId): Promise<void> {
    const known = this.getKnownPeers().filter((peerId) => peerId !== this.selfPeerId);
    const peers = known.length === 0 ? [] : sampleSize(known, Math.min(4, known.length));
    await Promise.all(
      peers.map((peerId) =>
        this.sendIndexMessage(peerId, { type: 'room_index_request', roomId }).catch((err) =>
          logger.debug(`[RoomScopedReplication] Room index request to ${peerId} failed: ${(err as Error).message}`),
        ),
      ),
    );
  }

  private async sendIndexMessage(peerId: string, payload: RoomIndexMessage): Promise<void> {
    const hashHint = payload.roomId;
    const message: PropagatedMessage<RoomIndexMessage> = {
      id: hashHint,
      payload,
      from: this.selfPeerId,
      timestamp: Date.now(),
    };
    await this.direct.send(peerId, ROOM_INDEX_PROTOCOL, message);
  }

  private async publishRoomAnnounce(roomId: RoomId, hash: ContentHash): Promise<void> {
    const message: PropagatedMessage<RoomAnnounce> = {
      id: hash,
      payload: { type: 'room_announce', roomId, hash },
      from: this.selfPeerId,
      timestamp: Date.now(),
    };
    await this.broadcast.publish(roomTopic(roomId), message);
  }

  private async rebuildIndexFromStore(): Promise<void> {
    for await (const hash of this.storage.getAllKeys()) {
      const bytes = await this.storage.get(hash);
      if (!bytes) continue;
      try {
        const decoded: unknown = this.serializer.deserialize(bytes);
        if (typeof decoded !== 'object' || decoded === null || !('roomId' in decoded)) continue;
        const roomIdValue = (decoded as { roomId: unknown }).roomId;
        if (typeof roomIdValue !== 'string') continue;
        this.indexHash(asRoomId(roomIdValue), hash);
      } catch {
        // Non-envelope payloads are not room-indexed.
      }
    }
  }

  private ensureRoomSet(roomId: RoomId): Set<ContentHash> {
    const existing = this.roomHashes.get(roomId);
    if (existing) return existing;
    const created = new Set<ContentHash>();
    this.roomHashes.set(roomId, created);
    return created;
  }

  private indexHash(roomId: RoomId, hash: ContentHash): void {
    this.ensureRoomSet(roomId).add(hash);
    this.hashToRoom.set(hash, roomId);
  }

  private emitApplied(roomId: RoomId, hash: ContentHash, bytes: Uint8Array): void {
    this.events.emit('applied', { roomId, hash, bytes });
  }
}

export const roomScopedReplication = (
  innerFactory: DeChatFactory<DataReplicationInterface> = topicBasedContentHashReplication(),
): DeChatFactory<RoomScopedReplication> => {
  return (components: DeChatComponents) =>
    new RoomScopedReplication(components, innerFactory(components) as InnerReplication);
};
