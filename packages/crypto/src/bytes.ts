/**
 * Portable byte / encoding helpers (no Node `Buffer`).
 */

const textEncoder = new TextEncoder();

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode a UTF-8 string to bytes. */
export const utf8ToBytes = (value: string): Uint8Array => textEncoder.encode(value);

/**
 * Normalize hash inputs accepted by portable digests.
 * Strings are UTF-8 encoded; `Uint8Array` is used as-is.
 */
export const toBytes = (input: string | Uint8Array): Uint8Array =>
  typeof input === 'string' ? utf8ToBytes(input) : input;

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return globalThis.btoa(binary);
  }

  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    result += BASE64_ALPHABET[(triple >> 18) & 63];
    result += BASE64_ALPHABET[(triple >> 12) & 63];
    result += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return result;
};

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  const cleaned = value.replace(/[^A-Za-z0-9+/]/gu, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const outLen = ((cleaned.length * 3) >> 2) - padding;
  const out = new Uint8Array(outLen);
  let outIndex = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const sextets = [0, 1, 2, 3].map((offset) => {
      const ch = cleaned[i + offset];
      return ch ? BASE64_ALPHABET.indexOf(ch) : 0;
    });
    const triple = (sextets[0]! << 18) | (sextets[1]! << 12) | (sextets[2]! << 6) | sextets[3]!;
    if (outIndex < outLen) out[outIndex++] = (triple >> 16) & 255;
    if (outIndex < outLen) out[outIndex++] = (triple >> 8) & 255;
    if (outIndex < outLen) out[outIndex++] = triple & 255;
  }
  return out;
};

/** Encode bytes as unpadded base64url (RFC 4648 §5). */
export const bytesToBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');

/** Decode unpadded or padded base64url into bytes. */
export const base64UrlToBytes = (value: string): Uint8Array => {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return base64ToBytes(padded);
};
