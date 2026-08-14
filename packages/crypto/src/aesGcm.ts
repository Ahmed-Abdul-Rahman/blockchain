import { utf8ToBytes } from './bytes';

const AES_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;

const requireSubtle = (): SubtleCrypto => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('[crypto] Web Crypto AES-GCM is required (Node 19+ / browsers).');
  }
  return subtle;
};

/**
 * Web Crypto `BufferSource` is `ArrayBufferView<ArrayBuffer>`. A generic `Uint8Array`
 * may be backed by SharedArrayBuffer, which tsc rejects (TS2769 / TS2345).
 */
const asBufferSource = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
};

/** 32-byte AES-256 key from CSPRNG. */
export const generateAes256Key = (): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));

export const aesGcmEncrypt = async (
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
): Promise<{ readonly nonce: Uint8Array; readonly ciphertext: Uint8Array }> => {
  if (keyBytes.byteLength !== AES_KEY_BYTES) {
    throw new Error('[crypto] AES-256-GCM key must be 32 bytes.');
  }
  const subtle = requireSubtle();
  const key = await subtle.importKey('raw', asBufferSource(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: asBufferSource(nonce) }, key, asBufferSource(plaintext)),
  );
  return { nonce, ciphertext };
};

export const aesGcmDecrypt = async (
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> => {
  if (keyBytes.byteLength !== AES_KEY_BYTES) {
    throw new Error('[crypto] AES-256-GCM key must be 32 bytes.');
  }
  const subtle = requireSubtle();
  const key = await subtle.importKey('raw', asBufferSource(keyBytes), { name: 'AES-GCM' }, false, ['decrypt']);
  return new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: asBufferSource(nonce) }, key, asBufferSource(ciphertext)),
  );
};

/** Canonical bytes signed for an encrypted chat envelope (ADR-0006). */
export const chatBodySignaturePayload = (parts: {
  readonly roomId: string;
  readonly messageId: string;
  readonly keyEpoch: number;
  readonly nonce: string;
  readonly ciphertext: string;
}): Uint8Array =>
  utf8ToBytes(`${parts.roomId}\n${parts.messageId}\n${parts.keyEpoch}\n${parts.nonce}\n${parts.ciphertext}`);
