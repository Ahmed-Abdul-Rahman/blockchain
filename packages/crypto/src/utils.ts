import * as ed from '@noble/ed25519';
import { sha1 } from '@noble/hashes/sha1';
import { sha256 as nobleSha256, sha512 as nobleSha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { toBytes } from './bytes';
import { crc32 } from './crc32';

/** Inputs accepted by portable digests (UTF-8 string or raw bytes). */
export type HashInput = string | Uint8Array;

/** SHA-256 hex digest (lowercase), matching prior Node `createHash('sha256')` output. */
export const sha256 = (message: HashInput): string => bytesToHex(nobleSha256(toBytes(message)));

/** SHA-1 hex digest — used by dial-election helpers that historically used Node SHA-1. */
export const sha1Hex = (message: HashInput): string => bytesToHex(sha1(toBytes(message)));

export const isValidInfoHash = (sourceHash: string, receivedHash: string): boolean => sourceHash === receivedHash;

export const buildNodeURL = (ipAddress: string | null, port: number | string | undefined): string =>
  `http://${ipAddress}:${port}`;

/**
 * Short protocol-prefix id derived from a CRC-32 of `hash` (base36, 7 chars).
 * Must stay stable across Node and browser — used as libp2p identify `protocolPrefix`.
 */
export const generateIdProtocolPrefix = (hash: string): string => {
  const crcValue = crc32(toBytes(hash));
  return crcValue.toString(36).padStart(7, '0').slice(0, 7);
};

export const generateTimestamp = (): string => new Date().toISOString();

/**
 * Cryptographically strong UUID v4.
 * Prefers `globalThis.crypto.randomUUID` (Node 19+ / browsers); falls back to Web Crypto getRandomValues.
 */
export const generateRandomUUID = (): string => {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID();
  }
  if (!webCrypto?.getRandomValues) {
    throw new Error('Secure random UUID requires Web Crypto (crypto.randomUUID or getRandomValues)');
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Converts a string input to a 256-bit numeric representation using SHA-256.
 * @param input - The string identifier to hash (e.g., PeerId or ContentHash)
 * @returns The numeric representation of the SHA-256 hash.
 */
export const toHashBigInt = (input: string): bigint => {
  const hexHash = sha256(input);
  return BigInt(`0x${hexHash}`);
};

/**
 * Calculates the XOR distance between two SHA-256 digests parsed as BigInts.
 */
export const calculateXorDistance = (a: bigint, b: bigint): bigint => a ^ b;

/**
 * Generate an Ed25519 keypair (private 32 bytes, public 32 bytes).
 * When `plainSeed` is provided, the secret is derived via SHA-512 (same as the previous Node path).
 */
export const genEd25519KeyPair = async (
  plainSeed?: string,
): Promise<{
  secret: Uint8Array;
  pub: Uint8Array;
}> => {
  let secret = ed.utils.randomSecretKey();
  if (plainSeed) {
    const secretHash64Bytes = nobleSha512(toBytes(plainSeed));
    secret = ed.utils.randomSecretKey(secretHash64Bytes.subarray(0, 32));
  }
  const pub = await ed.getPublicKeyAsync(secret);
  return { secret: new Uint8Array(secret), pub: new Uint8Array(pub) };
};
