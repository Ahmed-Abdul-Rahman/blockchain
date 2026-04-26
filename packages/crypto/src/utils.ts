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
