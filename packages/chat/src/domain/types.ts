export type MessageBody = {
  readonly text: string;
};

/** Wire envelope stored in the replica store — ciphertext, no plaintext body (ADR-0006). */
export interface EncryptedChatEnvelope {
  readonly type: 'chat_message';
  readonly roomId: string;
  readonly messageId: string;
  readonly senderPeerId: string;
  readonly senderPublicKey: string;
  readonly timestamp: number;
  readonly keyEpoch: number;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly signature: string;
}

export interface TombstoneEnvelope {
  readonly type: 'tombstone';
  readonly roomId: string;
  readonly targetHash: string;
  readonly senderPeerId: string;
  readonly timestamp: number;
}

export type ChatEnvelope = EncryptedChatEnvelope | TombstoneEnvelope;

/** Decrypted chat record used only for local history projection. */
export interface DecryptedChatRecord {
  readonly type: 'chat_message';
  readonly roomId: string;
  readonly messageId: string;
  readonly senderPeerId: string;
  readonly timestamp: number;
  readonly body: MessageBody;
  readonly displayName?: string;
}

export type ProjectableEnvelope = DecryptedChatRecord | TombstoneEnvelope;

export interface ChatMessageView {
  readonly hash: string;
  readonly roomId: string;
  readonly messageId: string;
  readonly senderPeerId: string;
  readonly timestamp: number;
  readonly body: MessageBody;
  readonly untrustedDisplayName?: string;
}

export type ChatEvent =
  | { readonly type: 'message'; readonly roomId: string; readonly message: ChatMessageView }
  | { readonly type: 'tombstone'; readonly roomId: string; readonly hash: string; readonly targetHash: string };

export const isEncryptedChatEnvelope = (value: unknown): value is EncryptedChatEnvelope => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === 'chat_message' &&
    typeof record.roomId === 'string' &&
    typeof record.messageId === 'string' &&
    typeof record.senderPeerId === 'string' &&
    typeof record.senderPublicKey === 'string' &&
    typeof record.timestamp === 'number' &&
    typeof record.keyEpoch === 'number' &&
    typeof record.nonce === 'string' &&
    typeof record.ciphertext === 'string' &&
    typeof record.signature === 'string'
  );
};

export const isTombstoneEnvelope = (value: unknown): value is TombstoneEnvelope => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === 'tombstone' &&
    typeof record.roomId === 'string' &&
    typeof record.targetHash === 'string' &&
    typeof record.senderPeerId === 'string' &&
    typeof record.timestamp === 'number'
  );
};
