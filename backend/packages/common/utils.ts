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

export const wait = (time: number): Promise<null> => {
  return new Promise((resolve) => setTimeout(() => resolve(null), time));
};
