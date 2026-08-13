import { Startable } from '@libp2p/interface';
import type { ContentHash } from '../types';
import type { RoomId } from './roomId';
import type { RoomScopeListener } from './types';

/**
 * Room isolation layer on top of an inner {@link DataReplicationInterface}.
 */
export interface RoomScopeInterface extends Startable {
  joinRoom(roomId: RoomId | string): Promise<void>;
  leaveRoom(roomId: RoomId | string): Promise<void>;
  isMember(roomId: RoomId | string): boolean;
  produce<T>(roomId: RoomId | string, data: T): Promise<ContentHash>;
  getRoomHashes(roomId: RoomId | string): readonly ContentHash[];
  subscribe(listener: RoomScopeListener): () => void;
  syncRoom(roomId: RoomId | string, peerId: string): Promise<void>;
}

export const isRoomScope = (value: unknown): value is RoomScopeInterface => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.joinRoom === 'function' &&
    typeof candidate.leaveRoom === 'function' &&
    typeof candidate.produce === 'function' &&
    typeof candidate.isMember === 'function'
  );
};
