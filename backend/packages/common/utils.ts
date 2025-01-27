import { createHash } from 'crypto';

export const sha256 = (message: string): string => createHash('sha256').update(message).digest('base64');

export const isValidInfoHash = (sourceHash: string, receivedHash: string): boolean => sourceHash === receivedHash;
