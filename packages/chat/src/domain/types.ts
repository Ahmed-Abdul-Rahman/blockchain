export type MessageBody = {
  readonly text: string;
};

export interface ChatMessageEnvelope {
  readonly type: 'chat_message';
  readonly roomId: string;
  readonly messageId: string;
  readonly senderPeerId: string;
  readonly timestamp: number;
  readonly body: MessageBody;
}

export interface TombstoneEnvelope {
  readonly type: 'tombstone';
  readonly roomId: string;
  readonly targetHash: string;
  readonly senderPeerId: string;
  readonly timestamp: number;
}

export type ChatEnvelope = ChatMessageEnvelope | TombstoneEnvelope;

export interface ChatMessageView {
  readonly hash: string;
  readonly roomId: string;
  readonly messageId: string;
  readonly senderPeerId: string;
  readonly timestamp: number;
  readonly body: MessageBody;
}

export type ChatEvent =
  | { readonly type: 'message'; readonly roomId: string; readonly message: ChatMessageView }
  | { readonly type: 'tombstone'; readonly roomId: string; readonly hash: string; readonly targetHash: string };

export const isChatMessageEnvelope = (value: unknown): value is ChatMessageEnvelope => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === 'chat_message' &&
    typeof record.roomId === 'string' &&
    typeof record.messageId === 'string' &&
    typeof record.senderPeerId === 'string' &&
    typeof record.timestamp === 'number' &&
    typeof record.body === 'object' &&
    record.body !== null &&
    typeof (record.body as Record<string, unknown>).text === 'string'
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
