import type { ContentHash } from '../types';
import type { RoomId } from './roomId';

export interface RoomAnnounce {
  readonly type: 'room_announce';
  readonly roomId: RoomId;
  readonly hash: ContentHash;
}

export interface RoomIndexRequest {
  readonly type: 'room_index_request';
  readonly roomId: RoomId;
}

export interface RoomIndex {
  readonly type: 'room_index';
  readonly roomId: RoomId;
  readonly hashes: readonly ContentHash[];
}

export type RoomIndexMessage = RoomIndexRequest | RoomIndex;

export interface RoomContentApplied {
  readonly roomId: RoomId;
  readonly hash: ContentHash;
  readonly bytes: Uint8Array;
}

export type RoomScopeListener = (event: RoomContentApplied) => void;
