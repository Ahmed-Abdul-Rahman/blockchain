import { ChatEnvelope, ChatMessageView, isChatMessageEnvelope, isTombstoneEnvelope } from '../domain/types';

export interface StoredEnvelope {
  readonly hash: string;
  readonly envelope: ChatEnvelope;
}

/**
 * Replays stored room envelopes: tombstones hide target hashes; remaining
 * chat messages are ordered by timestamp then messageId (ADR-0002).
 */
export const projectRoomHistory = (records: readonly StoredEnvelope[]): readonly ChatMessageView[] => {
  const tombstoned = new Set<string>();
  for (const record of records) {
    if (isTombstoneEnvelope(record.envelope)) {
      tombstoned.add(record.envelope.targetHash);
    }
  }

  const visible: ChatMessageView[] = [];
  for (const record of records) {
    if (!isChatMessageEnvelope(record.envelope)) continue;
    if (tombstoned.has(record.hash)) continue;
    visible.push({
      hash: record.hash,
      roomId: String(record.envelope.roomId),
      messageId: record.envelope.messageId,
      senderPeerId: record.envelope.senderPeerId,
      timestamp: record.envelope.timestamp,
      body: record.envelope.body,
    });
  }

  return visible.toSorted((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.messageId.localeCompare(b.messageId);
  });
};
