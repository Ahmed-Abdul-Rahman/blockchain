import { logger } from '@dechat/common';
import type { DirectPropagationInterface, PropagatedMessage, PropagationContext } from '@dechat/core';
import { base64UrlToBytes, bytesToBase64Url } from '@dechat/crypto';
import { RoomKeyRing } from './RoomKeyRing';

export const ROOM_KEY_PROTOCOL = '/deChat/v1/protocol/room-key';

export interface RoomKeyRequest {
  readonly type: 'room_key_request';
  readonly roomId: string;
}

export interface RoomKeyOffer {
  readonly type: 'room_key_offer';
  readonly roomId: string;
  readonly epoch: number;
  readonly key: string;
}

export type RoomKeyMessage = RoomKeyRequest | RoomKeyOffer;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRoomKeyMessage = (value: unknown): value is RoomKeyMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type === 'room_key_request') {
    return typeof record.roomId === 'string';
  }
  if (record.type === 'room_key_offer') {
    return typeof record.roomId === 'string' && typeof record.epoch === 'number' && typeof record.key === 'string';
  }
  return false;
};

export interface RoomKeyExchangeOptions {
  readonly ring: RoomKeyRing;
  readonly direct: DirectPropagationInterface;
  readonly selfPeerId: string;
  readonly getVerifiedPeers: () => readonly string[];
  readonly isMember: (roomId: string) => boolean;
  readonly waitMs?: number;
}

/**
 * Distributes in-memory room keys to verified peers over Noise direct streams.
 */
export class RoomKeyExchange {
  private readonly ring: RoomKeyRing;
  private readonly direct: DirectPropagationInterface;
  private readonly selfPeerId: string;
  private readonly getVerifiedPeers: () => readonly string[];
  private readonly isMember: (roomId: string) => boolean;
  private readonly waitMs: number;
  private readonly boundHandler: (message: PropagatedMessage<RoomKeyMessage>, ctx: PropagationContext) => Promise<void>;

  constructor(options: RoomKeyExchangeOptions) {
    this.ring = options.ring;
    this.direct = options.direct;
    this.selfPeerId = options.selfPeerId;
    this.getVerifiedPeers = options.getVerifiedPeers;
    this.isMember = options.isMember;
    this.waitMs = options.waitMs ?? 1_500;
    this.boundHandler = (message, ctx) => this.onMessage(message, ctx);
  }

  public start(): void {
    this.direct.onReceive(ROOM_KEY_PROTOCOL, this.boundHandler);
  }

  public async stop(): Promise<void> {
    await this.direct.removeHandler(ROOM_KEY_PROTOCOL, this.boundHandler);
  }

  public async ensureKey(roomId: string): Promise<void> {
    if (this.ring.current(roomId)) {
      await this.offerToPeers(roomId);
      return;
    }

    const peers = this.getVerifiedPeers().filter((peerId) => peerId !== this.selfPeerId);
    if (peers.length === 0) {
      this.ring.create(roomId);
      return;
    }

    await this.requestFromPeers(roomId, peers);
    const deadline = Date.now() + this.waitMs;
    while (Date.now() < deadline) {
      if (this.ring.current(roomId)) return;
      await sleep(50);
    }
    if (!this.ring.current(roomId)) {
      this.ring.create(roomId);
    }
    await this.offerToPeers(roomId);
  }

  public async offerToPeers(roomId: string): Promise<void> {
    const current = this.ring.current(roomId);
    if (!current) return;
    const peers = this.getVerifiedPeers().filter((peerId) => peerId !== this.selfPeerId);
    await Promise.all(
      peers.map((peerId) =>
        this.send(peerId, {
          type: 'room_key_offer',
          roomId,
          epoch: current.epoch,
          key: bytesToBase64Url(current.key),
        }).catch((err) => {
          logger.debug(`[RoomKeyExchange] Offer to ${peerId} failed: ${(err as Error).message}`);
        }),
      ),
    );
  }

  private async requestFromPeers(roomId: string, peers: readonly string[]): Promise<void> {
    await Promise.all(
      peers.map((peerId) =>
        this.send(peerId, { type: 'room_key_request', roomId }).catch((err) => {
          logger.debug(`[RoomKeyExchange] Request to ${peerId} failed: ${(err as Error).message}`);
        }),
      ),
    );
  }

  private async onMessage(message: PropagatedMessage<RoomKeyMessage>, ctx: PropagationContext): Promise<void> {
    const payload = message.payload;
    if (!isRoomKeyMessage(payload)) return;
    const from = ctx.from.toString();
    if (!this.isMember(payload.roomId)) return;

    if (payload.type === 'room_key_request') {
      const current = this.ring.current(payload.roomId);
      if (!current) return;
      await this.send(from, {
        type: 'room_key_offer',
        roomId: payload.roomId,
        epoch: current.epoch,
        key: bytesToBase64Url(current.key),
      });
      return;
    }

    try {
      this.ring.adopt(payload.roomId, payload.epoch, base64UrlToBytes(payload.key));
    } catch (err) {
      logger.debug(`[RoomKeyExchange] Ignoring invalid room key offer: ${(err as Error).message}`);
    }
  }

  private async send(peerId: string, payload: RoomKeyMessage): Promise<void> {
    const message: PropagatedMessage<RoomKeyMessage> = {
      id: payload.roomId,
      payload,
      from: this.selfPeerId,
      timestamp: Date.now(),
    };
    await this.direct.send(peerId, ROOM_KEY_PROTOCOL, message);
  }
}
