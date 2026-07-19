import { createHash, randomUUID } from 'node:crypto';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url } from './bytes';
import { generateIdProtocolPrefix, generateRandomUUID, sha1Hex, sha256, toHashBigInt } from './utils';

/** Golden vectors captured from Node crypto/zlib before the noble migration. */
const GOLDEN = [
  {
    input: '',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    prefix: '0000000',
  },
  {
    input: 'hello',
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    prefix: '0f01gna',
  },
  {
    input: 'deChat',
    sha256: '907bef2b5b3955878904176de640796a65957d329c734d6d305ca9157f8a1d5d',
    sha1: 'e1ca0c36429036279865189674bdd76689ec0484',
    prefix: '162hg7u',
  },
  {
    input: 'a'.repeat(1000),
    sha256: '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    sha1: '291e9a6c66994949b57ba5e650361e98fc36b1ba',
    prefix: '16shbsz',
  },
] as const;

describe('portable crypto utils', () => {
  it('matches golden sha256 / sha1 / crc prefix vectors', () => {
    for (const vector of GOLDEN) {
      expect(sha256(vector.input)).toBe(vector.sha256);
      expect(sha1Hex(vector.input)).toBe(vector.sha1);
      expect(generateIdProtocolPrefix(vector.input)).toBe(vector.prefix);
    }
  });

  it('matches live Node createHash / zlib.crc32 for the same inputs', () => {
    for (const vector of GOLDEN) {
      expect(sha256(vector.input)).toBe(createHash('sha256').update(vector.input).digest('hex'));
      expect(sha1Hex(vector.input)).toBe(createHash('sha1').update(vector.input).digest('hex'));
      const nodePrefix = ((nodeCrc32(vector.input) >>> 0).toString(36).padStart(7, '0') as string).slice(0, 7);
      expect(generateIdProtocolPrefix(vector.input)).toBe(nodePrefix);
    }
  });

  it('hashes Uint8Array the same as the UTF-8 string', () => {
    const text = 'deChat';
    expect(sha256(new TextEncoder().encode(text))).toBe(sha256(text));
  });

  it('toHashBigInt matches 0x-prefixed sha256', () => {
    const input = 'peer-a';
    expect(toHashBigInt(input)).toBe(BigInt(`0x${sha256(input)}`));
  });

  it('generateRandomUUID returns a UUID-shaped string', () => {
    const id = generateRandomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // Smoke that Web Crypto path is available in Node test runtime
    expect(typeof randomUUID()).toBe('string');
  });

  it('round-trips base64url without Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/u);
    expect([...base64UrlToBytes(encoded)]).toEqual([...bytes]);
  });
});
