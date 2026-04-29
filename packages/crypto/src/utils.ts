import * as ed from '@noble/ed25519';
import { createHash } from 'crypto';
import { crc32 } from 'zlib';

export const sha256 = (message: string): string => createHash('sha256').update(message).digest('hex');

export const isValidInfoHash = (sourceHash: string, receivedHash: string): boolean => sourceHash === receivedHash;

export const buildNodeURL = (ipAddress: string | null, port: number | string | undefined): string =>
  `http://${ipAddress}:${port}`;

export const generateIdProtocolPrefix = (hash: string): string => {
  // Generate CRC32 integer hash and convert it to base 36
  const crcValue = crc32(hash) >>> 0; // Ensure positive integer using unsigned shift
  return crcValue.toString(36).padStart(7, '0').slice(0, 7);
};

export const generateTimestamp = (): string => new Date().toISOString();

/**
 * Converts a string input to a 256-bit numeric representation using SHA-256.
 * * @param input - The string identifier to hash (e.g., PeerId or ContentHash)
 * @returns {bigint} The numeric representation of the SHA-256 hash.
 */
export const toHashBigInt = (input: string): bigint => {
  const hexHash = createHash('sha256').update(input).digest('hex');
  return BigInt(`0x${hexHash}`);
};

/**
 * Calculates the XOR distance between a's hash and the b's hash.
 * * @param a - The SHA-256 hash parsed as a BigInt.
 * @param b - The SHA-256 hash parsed as a BigInt.
 * @returns {bigint} The absolute XOR distance.
 */
export const calculateXorDistance = (a: bigint, b: bigint): bigint => {
  return a ^ b;
};

/**
 * Generate a new keypair (private 32 bytes, public 32 bytes)
 * @param plainSeed
 * @returns {Promise<{ secret: Uint8Array<ArrayBufferLike>; pub: Uint8Array; }>}
 */
export const genEd25519KeyPair = async (
  plainSeed?: string,
): Promise<{
  secret: Uint8Array<ArrayBufferLike>;
  pub: Uint8Array;
}> => {
  let secret = ed.utils.randomSecretKey();
  if (plainSeed) {
    const msgBytes = new TextEncoder().encode(plainSeed);
    const secretHash64Bytes = createHash('sha512').update(msgBytes).digest();
    secret = ed.utils.randomSecretKey(secretHash64Bytes.subarray(0, 32)); // Uint8Array(32)
  }
  const pub = await ed.getPublicKeyAsync(secret); // Uint8Array(32)
  return { secret: new Uint8Array(secret), pub: new Uint8Array(pub) };
};
