import { peerIdFromNodeSeed } from '@dechat/core';
import { bytesToBase64Url } from '@dechat/crypto';

const SEED_BYTES = 32;
const MAX_SEED_CHARS = 512;

/**
 * Cryptographically strong identity seed (32 random bytes, unpadded base64url).
 * This is the node seed: storing and reusing it restores the same PeerId.
 */
export const generateIdentitySeed = (): string => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  return bytesToBase64Url(bytes);
};

/**
 * Normalizes a caller-supplied seed. Any non-empty string is accepted so existing
 * node seeds keep working; generated seeds are 43-character base64url.
 */
export const parseIdentitySeed = (input: string): string => {
  const seed = input.trim();
  if (seed.length === 0) {
    throw new Error('[identity] Identity seed must be a non-empty string.');
  }
  if (seed.length > MAX_SEED_CHARS) {
    throw new Error(`[identity] Identity seed is too long (max ${MAX_SEED_CHARS} characters).`);
  }
  return seed;
};

/** Canonical form to persist or show the user. Not a vault — the caller stores it. */
export const exportIdentitySeed = (seed: string): string => parseIdentitySeed(seed);

/** PeerId that {@link createChatClient} will have for this seed, without starting a node. */
export const peerIdFromIdentitySeed = async (seed: string): Promise<string> =>
  peerIdFromNodeSeed(parseIdentitySeed(seed));
