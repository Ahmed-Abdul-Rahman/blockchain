import { ContentHashStrategyInterface } from '../data-replication/content-hash/types';
import { TrieNodeSnapshot } from './types';

/**
 * Represents a single node within the Incremental Prefix Merkle Trie.
 */
export class TrieNode {
  public children: Map<string, TrieNode> = new Map();
  public hash: string = '';
  public readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }
}

/**
 * An Incremental Prefix Merkle Trie designed for highly efficient,
 * deterministic background Anti-Entropy Syncs.
 */
export class PrefixTrie {
  private readonly root: TrieNode;
  private readonly hashStrategy: ContentHashStrategyInterface;

  constructor(hashStrategy: ContentHashStrategyInterface) {
    this.root = new TrieNode('');
    this.hashStrategy = hashStrategy;
  }

  /**
   * Incrementally inserts a sha256 message hash into the Trie.
   * Updates the Merkle root hashes up the chain automatically.
   * * @param key A 64-character sha256 hex string representing the chat message.
   */
  public insert(key: string): void {
    const sanitizedKey = key.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sanitizedKey)) {
      throw new Error(`[PrefixTrie] Invalid key format. Expected 64-char hex string, got: ${key}`);
    }
    this._insert(this.root, sanitizedKey, 0);
  }

  /**
   * Compares a remote peer's Top-N snapshot against our local Trie.
   * Identifies all divergent branches/prefixes.
   * * @param remoteSnapshot The `TrieNodeSnapshot` payload received from a peer.
   * @returns An array of string prefixes where data differs.
   */
  public findMismatches(remoteSnapshot: TrieNodeSnapshot): string[] {
    return this._compare(this.root, remoteSnapshot);
  }

  /**
   * Generates a Top-N snapshot of the current tree state for network exchange.
   * * @param maxLevels How many levels deep the snapshot should go (e.g., 2 levels).
   * @returns A serialized `TrieNodeSnapshot` ready for transport.
   */
  public getTopN(maxLevels: number): TrieNodeSnapshot {
    return this._getSnapshot(this.root, maxLevels, 0);
  }

  /**
   * Fetches a snapshot of specific branches for deep network reconciliation.
   * * @param prefixes An array of hex prefixes (e.g., ['a3', 'f5b'])
   * @param levels How many levels deep to snapshot from the requested prefix
   * @returns A dictionary mapping the prefix to its TrieNodeSnapshot
   */
  public getBranches(prefixes: string[], levels: number = 1): Record<string, TrieNodeSnapshot> {
    const branches: Record<string, TrieNodeSnapshot> = {};
    for (const prefix of prefixes) {
      let current: TrieNode | undefined = this.root;
      // Traverse down to the requested prefix
      for (const char of prefix) {
        if (!current) break;
        current = current.children.get(char);
      }
      if (current) branches[prefix] = this._getSnapshot(current, levels, 0);
    }
    return branches;
  }

  /**
   * Internal recursive insertion method.
   */
  private _insert(node: TrieNode, key: string, depth: number): void {
    // Base Case: We've reached the leaf representing the full 64-char hash
    if (depth === key.length) {
      node.hash = key; // The hash of a leaf is simply the message hash itself
      return;
    }
    const char = key[depth];
    let child = node.children.get(char);
    if (!child) {
      child = new TrieNode(node.prefix + char);
      node.children.set(char, child);
    }
    this._insert(child, key, depth + 1);
    this.updateNodeHash(node);
  }

  /**
   * Deterministically calculates the Merkle hash of an internal node
   * based on its current children.
   */
  private updateNodeHash(node: TrieNode): void {
    // Sort the keys to guarantee absolute deterministic ordering across all peers
    const sortedKeys = Array.from(node.children.keys()).sort();

    // Map to an array of hashes
    const childHashes = sortedKeys.map((key) => node.children.get(key)!.hash);

    // Delegate to the injected hash strategy.
    // It will canonically serialize the array (e.g., '["hash1","hash2"]') and hash it.
    node.hash = this.hashStrategy.hash(childHashes);
  }

  private _getSnapshot(node: TrieNode, maxLevels: number, currentDepth: number): TrieNodeSnapshot {
    const snapshot: TrieNodeSnapshot = {
      prefix: node.prefix,
      hash: node.hash,
    };
    if (currentDepth < maxLevels && node.children.size > 0) {
      // Map the internal Map structure to a simple JSON-serializable Record
      snapshot.children = {};
      for (const [char, child] of node.children.entries()) {
        snapshot.children[char] = this._getSnapshot(child, maxLevels, currentDepth + 1);
      }
    }
    return snapshot;
  }

  private _compare(localNode: TrieNode | undefined, remoteSnapshot: TrieNodeSnapshot): string[] {
    // If we don't have this local branch at all, we are missing all data under this prefix
    if (!localNode) return [remoteSnapshot.prefix];

    // If the hashes match perfectly, our trees are converged here. Zero missing data.
    if (localNode.hash === remoteSnapshot.hash) return [];

    const mismatches: string[] = [];

    if (!remoteSnapshot.children) {
      // The remote peer didn't send children for this level, so we only know there's
      // a mismatch at this prefix, but not exactly which leaves. We must request deeper data.
      mismatches.push(remoteSnapshot.prefix);
    } else {
      // Drill deeper into the provided remote children
      for (const [char, remoteChild] of Object.entries(remoteSnapshot.children)) {
        const localChild = localNode.children.get(char);
        mismatches.push(...this._compare(localChild, remoteChild));
      }
    }
    return mismatches;
  }
}
