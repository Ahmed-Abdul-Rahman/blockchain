/**
 * Represents a serialized snapshot of a Prefix Trie node.
 * Used during the Top-N Batch Exchange to compare states over the network.
 */
export interface TrieNodeSnapshot {
  /** The hex prefix up to this node (e.g., "a3f") */
  readonly prefix: string;

  /** The deterministic Merkle hash of this node and all its children */
  readonly hash: string;

  /** The child branches, mapped by their next hex character ('0'-'f') */
  children?: Record<string, TrieNodeSnapshot>;
}

/**
 * Discriminated Union representing all possible messages over the Anti-Entropy stream.
 * Can support Bidirectional Sync in the future.
 */
export type AntiEntropyMessage =
  | { type: 'REQUEST_TOP_N'; levels: number }
  | { type: 'RESPONSE_TOP_N'; snapshot: TrieNodeSnapshot }
  | { type: 'REQUEST_BRANCHES'; prefixes: string[] }
  | { type: 'RESPONSE_BRANCHES'; branches: Record<string, TrieNodeSnapshot> };

/**
 * Why a drill-down sync stopped before fully reconciling the two tries.
 * - `timeout`: an RPC threw or timed out mid-flow.
 * - `badResponse`: the peer replied with an unexpected/mismatched message type.
 * - `depthCap`: the 64-level SHA256 drill-down limit was hit with branches still pending.
 */
export type SyncIncompleteReason = 'timeout' | 'badResponse' | 'depthCap';

/**
 * Result of an Anti-Entropy drill-down exchange.
 *
 * `complete` means the diff is authoritative: an empty `hashes` array genuinely
 * signals convergence. `partial` means the diff was cut short, so `hashes` is only
 * what we managed to collect and an empty array must NOT be read as convergence.
 */
export type SyncOutcome =
  | { readonly status: 'complete'; readonly hashes: readonly string[] }
  | { readonly status: 'partial'; readonly hashes: readonly string[]; readonly reason: SyncIncompleteReason };

export const ANTI_ENTROPY_PROTOCOL = '/deChat/v1/anti-entropy/1.0.0';
