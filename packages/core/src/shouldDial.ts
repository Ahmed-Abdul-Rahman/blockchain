import crypto, { createHash } from 'node:crypto';

export interface ShouldDialOptions {
  /** Our own peer ID (string form, e.g. base58) */
  selfPeerId: string;

  /** The peer we just discovered */
  discoveredPeerId: string;

  /** Whether this node is "new" (true = recently joined) */
  isNewPeer: boolean;

  /** How many peers should a new peer dial? */
  maxOutbound?: number;

  /** Backoff probability for existing peers */
  electionModulo?: number;
}

/**
 * Decide if the current node should initiate a dial to a discovered peer.
 * Implements a hybrid strategy:
 *
 *  - New peer: dials up to `maxOutbound` peers, after debounce.
 *  - Existing peers: only dial if elected (hash-based).
 */
export const shouldDial = ({
  selfPeerId,
  discoveredPeerId,
  isNewPeer,
  maxOutbound = 2,
  electionModulo = 10,
}: ShouldDialOptions): boolean => {
  // Prevent self-dialing
  if (selfPeerId === discoveredPeerId) return false;

  if (isNewPeer) {
    // New peer picks a small, deterministic set of outbound targets
    return pickDeterministic(selfPeerId, discoveredPeerId, maxOutbound);
  }
  // Existing peers run election to avoid bombardment
  return isDesignatedDialer(selfPeerId, discoveredPeerId, electionModulo);
};

/**
 * Deterministic picker: only true if discoveredId falls into the "top K"
 * slots for this selfPeerId
 .
 */
const pickDeterministic = (selfPeerId: string, discoveredPeerId: string, k: number): boolean => {
  const hash = hashToBigInt(selfPeerId + discoveredPeerId);
  return hash % BigInt(k) === 0n;
};

/**
 * Election: only 1 in `modulo` peers dials the discovered peer.
 */
const isDesignatedDialer = (selfPeerId: string, discoveredPeerId: string, modulo: number): boolean => {
  const hash = hashToBigInt(selfPeerId + discoveredPeerId);
  return hash % BigInt(modulo) === 0n;
};

/**
 * Hash a string into a BigInt (stable, deterministic).
 */
const hashToBigInt = (input: string): bigint => {
  const h = crypto.createHash('sha1').update(input).digest('hex');
  return BigInt('0x' + h);
};

/**
 * Decide who dials a new peer deterministically
 * based on lexicographic ordering of peerIds.
 */
export const shouldDialNewPeer = (
  selfPeerId: string,
  newPeerId: string,
  allKnownPeers: string[],
  electedPeers: number = 1,
): boolean => {
  // If we *are* the new peer, skip (let others decide)
  if (selfPeerId === newPeerId) return false;

  const selfHash = hashToBigInt(selfPeerId + newPeerId);
  const threshold = (BigInt(electedPeers) * BigInt(2) ** BigInt(256)) / BigInt(allKnownPeers.length);
  return selfHash < threshold;
};
