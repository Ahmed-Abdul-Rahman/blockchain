const ROOM_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

export type RoomId = string & { readonly __brand: 'RoomId' };

export const isValidRoomId = (value: string): boolean => ROOM_ID_PATTERN.test(value);

export const asRoomId = (value: string): RoomId => {
  if (!isValidRoomId(value)) {
    throw new Error(`[RoomScope] Invalid room id "${value}". Use 1–128 characters from [a-zA-Z0-9._-].`);
  }
  return value as RoomId;
};

export const ROOM_TOPIC_PREFIX = '/deChat/v1/room/';

export const roomTopic = (roomId: RoomId): string => `${ROOM_TOPIC_PREFIX}${roomId}`;

export const ROOM_INDEX_PROTOCOL = '/deChat/v1/protocol/room-index';
