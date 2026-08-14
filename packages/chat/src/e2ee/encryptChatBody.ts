import { peerIdFromEd25519PublicKeyBytes } from '@dechat/core';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64UrlToBytes,
  bytesToBase64Url,
  chatBodySignaturePayload,
  signEd25519,
  utf8ToBytes,
  verifyEd25519,
} from '@dechat/crypto';
import { EncryptedChatEnvelope, isEncryptedChatEnvelope, MessageBody } from '../domain/types';

export interface EncryptChatBodyInput {
  readonly roomId: string;
  readonly messageId: string;
  readonly senderPeerId: string;
  readonly senderPublicKey: Uint8Array;
  readonly senderSecret: Uint8Array;
  readonly timestamp: number;
  readonly keyEpoch: number;
  readonly roomKey: Uint8Array;
  readonly body: MessageBody;
  readonly displayName?: string;
}

export interface DecryptedChatBody {
  readonly body: MessageBody;
  readonly displayName?: string;
}

export const encryptChatBody = async (input: EncryptChatBodyInput): Promise<EncryptedChatEnvelope> => {
  const plaintext = {
    text: input.body.text,
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
  };
  const { nonce, ciphertext } = await aesGcmEncrypt(input.roomKey, utf8ToBytes(JSON.stringify(plaintext)));
  const nonceB64 = bytesToBase64Url(nonce);
  const ciphertextB64 = bytesToBase64Url(ciphertext);
  const signature = await signEd25519(
    chatBodySignaturePayload({
      roomId: input.roomId,
      messageId: input.messageId,
      keyEpoch: input.keyEpoch,
      nonce: nonceB64,
      ciphertext: ciphertextB64,
    }),
    input.senderSecret,
  );

  return {
    type: 'chat_message',
    roomId: input.roomId,
    messageId: input.messageId,
    senderPeerId: input.senderPeerId,
    senderPublicKey: bytesToBase64Url(input.senderPublicKey),
    timestamp: input.timestamp,
    keyEpoch: input.keyEpoch,
    nonce: nonceB64,
    ciphertext: ciphertextB64,
    signature: bytesToBase64Url(signature),
  };
};

export const decryptChatBody = async (
  envelope: EncryptedChatEnvelope,
  roomKey: Uint8Array,
): Promise<DecryptedChatBody | undefined> => {
  let senderPublicKey: Uint8Array;
  try {
    senderPublicKey = base64UrlToBytes(envelope.senderPublicKey);
  } catch {
    return undefined;
  }
  if (peerIdFromEd25519PublicKeyBytes(senderPublicKey).toString() !== envelope.senderPeerId) {
    return undefined;
  }

  const payload = chatBodySignaturePayload({
    roomId: envelope.roomId,
    messageId: envelope.messageId,
    keyEpoch: envelope.keyEpoch,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  });
  let signature: Uint8Array;
  try {
    signature = base64UrlToBytes(envelope.signature);
  } catch {
    return undefined;
  }
  if (!(await verifyEd25519(signature, payload, senderPublicKey))) {
    return undefined;
  }

  try {
    const plainBytes = await aesGcmDecrypt(
      roomKey,
      base64UrlToBytes(envelope.nonce),
      base64UrlToBytes(envelope.ciphertext),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plainBytes));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.text !== 'string' || record.text.length === 0) return undefined;
    if (record.displayName !== undefined && typeof record.displayName !== 'string') return undefined;
    return {
      body: { text: record.text },
      ...(typeof record.displayName === 'string' ? { displayName: record.displayName } : {}),
    };
  } catch {
    return undefined;
  }
};

export const asEncryptedChatEnvelope = (value: unknown): EncryptedChatEnvelope | undefined =>
  isEncryptedChatEnvelope(value) ? value : undefined;
