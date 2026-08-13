export interface RoomKeyMaterial {
  readonly epoch: number;
  readonly key: Uint8Array;
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) {
    mismatch |= a[i]! ^ b[i]!;
  }
  return mismatch === 0;
};

/**
 * In-memory per-room AES keys. Never persisted to the replica store (ADR-0006).
 */
export class RoomKeyRing {
  private readonly rooms = new Map<string, { currentEpoch: number; keys: Map<number, Uint8Array> }>();

  public current(roomId: string): RoomKeyMaterial | undefined {
    const state = this.rooms.get(roomId);
    if (!state) return undefined;
    const key = state.keys.get(state.currentEpoch);
    if (!key) return undefined;
    return { epoch: state.currentEpoch, key };
  }

  public get(roomId: string, epoch: number): Uint8Array | undefined {
    return this.rooms.get(roomId)?.keys.get(epoch);
  }

  public create(roomId: string): RoomKeyMaterial {
    const existing = this.current(roomId);
    if (existing) return existing;
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    this.rooms.set(roomId, { currentEpoch: 1, keys: new Map([[1, key]]) });
    return { epoch: 1, key };
  }

  public adopt(roomId: string, epoch: number, key: Uint8Array): void {
    let state = this.rooms.get(roomId);
    if (!state) {
      state = { currentEpoch: epoch, keys: new Map() };
      this.rooms.set(roomId, state);
    }
    const existing = state.keys.get(epoch);
    if (existing && !bytesEqual(existing, key)) {
      return;
    }
    state.keys.set(epoch, key);
    if (epoch > state.currentEpoch) {
      state.currentEpoch = epoch;
    }
  }

  public rotate(roomId: string): RoomKeyMaterial {
    const state = this.rooms.get(roomId);
    if (!state) {
      return this.create(roomId);
    }
    const epoch = state.currentEpoch + 1;
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    state.keys.set(epoch, key);
    state.currentEpoch = epoch;
    return { epoch, key };
  }

  public discard(roomId: string): void {
    this.rooms.delete(roomId);
  }

  public discardAll(): void {
    this.rooms.clear();
  }
}
