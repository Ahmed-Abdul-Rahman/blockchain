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
    // Re-root the local cursor at the snapshot's prefix. Branch snapshots (prefix !== '')
    // must be compared against the matching local subtree, not the root — otherwise we
    // compare unrelated branches and both miss real mismatches and invent false ones.
    let localNode: TrieNode | undefined = this.root;
    for (const char of remoteSnapshot.prefix) {
      localNode = localNode?.children.get(char);
      if (!localNode) break;
    }
    return this._compare(localNode, remoteSnapshot);
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
      // Always return an entry for every requested prefix. An empty-hash snapshot
      // explicitly means "no data under this prefix", letting the requester tell a
      // genuinely absent branch (nothing to pull) apart from a dropped response key.
      branches[prefix] = current ? this._getSnapshot(current, levels, 0) : { prefix, hash: '' };
    }
    return branches;
  }

  /**
   * Resets the trie to an empty state. Used when the backing store is cleared.
   */
  public clear(): void {
    this.root.children.clear();
    this.root.hash = '';
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
    // The remote reports no data under this prefix (empty/absent node): nothing to pull.
    if (!remoteSnapshot.hash) return [];

    // Identical Merkle hashes: this subtree is fully converged, nothing missing.
    if (localNode && localNode.hash === remoteSnapshot.hash) return [];

    // Hashes differ (or we lack this branch entirely). If the remote expanded its children,
    // drill into each one. We descend even when there is no local node here, because every
    // remote child is then something we are missing and must resolve down to its leaves.
    if (remoteSnapshot.children) {
      const mismatches: string[] = [];
      for (const [char, remoteChild] of Object.entries(remoteSnapshot.children)) {
        mismatches.push(...this._compare(localNode?.children.get(char), remoteChild));
      }
      return mismatches;
    }

    // The remote did not expand children at this level, so we cannot resolve further from
    // this snapshot. Report this prefix so the caller fetches a deeper snapshot — or, if it
    // is a full 64-char hash, it is a concrete missing leaf.
    return [remoteSnapshot.prefix];
  }
}
