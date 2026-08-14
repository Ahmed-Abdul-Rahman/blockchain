import { ChatMessageView, DecryptedChatRecord, isTombstoneEnvelope, ProjectableEnvelope } from '../domain/types';

export interface StoredEnvelope {
  readonly hash: string;
  readonly envelope: ProjectableEnvelope;
}

/**
 * Replays stored room envelopes: tombstones hide target hashes; remaining
 * chat messages are ordered by timestamp then messageId (ADR-0002).
 * Callers decrypt CAS payloads before passing them here.
 */
export const projectRoomHistory = (records: readonly StoredEnvelope[]): readonly ChatMessageView[] => {
  const tombstoned = new Set<string>();
  for (const record of records) {
    const envelope = record.envelope;
    if (isTombstoneEnvelope(envelope)) {
      tombstoned.add(envelope.targetHash);
    }
  }

  const visible: ChatMessageView[] = [];
  for (const record of records) {
    if (record.envelope.type !== 'chat_message') continue;
    if (tombstoned.has(record.hash)) continue;
    const envelope: DecryptedChatRecord = record.envelope;
    visible.push({
      hash: record.hash,
      roomId: String(envelope.roomId),
      messageId: envelope.messageId,
      senderPeerId: envelope.senderPeerId,
      timestamp: envelope.timestamp,
      body: envelope.body,
      untrustedDisplayName: envelope.displayName,
    });
  }

  return visible.toSorted((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.messageId.localeCompare(b.messageId);
  });
};
