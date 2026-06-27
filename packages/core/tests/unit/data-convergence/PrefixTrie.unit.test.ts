/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { describe, expect, it } from 'vitest';
import { PrefixTrie } from '../../../src/data-convergence/PrefixTrie';
import { ContentHashStrategyInterface } from '../../../src/data-replication/content-hash/types';

// Deterministic, fixed-length (FNV-1a) hash so nested children don't blow up string length.
const mockHashStrategy: ContentHashStrategyInterface = {
  hash: (data) => {
    const str = JSON.stringify(data);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0') as any;
  },
  algorithm: 'mock',
};

const key = (head: string): string => (head + '0'.repeat(64)).slice(0, 64);

describe('PrefixTrie.getBranches', () => {
  it('returns an entry for EVERY requested prefix, even absent ones', () => {
    const trie = new PrefixTrie(mockHashStrategy);
    trie.insert(key('a1')); // -> 'a10000...'
    trie.insert(key('a2')); // -> 'a20000...'

    const branches = trie.getBranches(['a', 'f', 'a1'], 2);

    // Present prefixes resolve to real (non-empty) snapshots.
    expect(branches).toHaveProperty('a');
    expect(branches.a.hash).not.toBe('');
    expect(branches.a.children).toBeDefined();

    expect(branches).toHaveProperty('a1');
    expect(branches.a1.hash).not.toBe('');

    // Absent prefix is still present in the response, marked empty (no data here).
    expect(branches).toHaveProperty('f');
    expect(branches.f).toEqual({ prefix: 'f', hash: '' });
  });

  it('marks a prefix that partially exists then dead-ends as empty', () => {
    const trie = new PrefixTrie(mockHashStrategy);
    trie.insert(key('ab')); // only 'ab...' exists

    const branches = trie.getBranches(['az'], 2); // 'a' exists, 'az' does not

    expect(branches).toHaveProperty('az');
    expect(branches.az).toEqual({ prefix: 'az', hash: '' });
  });
});

describe('PrefixTrie.findMismatches', () => {
  it('treats an empty-hash remote snapshot as nothing to pull', () => {
    const trie = new PrefixTrie(mockHashStrategy);
    trie.insert(key('a1'));

    // Remote explicitly reports "no data under this prefix".
    expect(trie.findMismatches({ prefix: 'zz', hash: '' })).toEqual([]);
    // Even when we locally have data under that prefix, there is nothing to fetch.
    expect(trie.findMismatches({ prefix: 'a', hash: '' })).toEqual([]);
  });

  it('flags a prefix we lack entirely against a non-empty remote snapshot', () => {
    const local = new PrefixTrie(mockHashStrategy); // empty
    const remote = new PrefixTrie(mockHashStrategy);
    remote.insert(key('c9'));

    const mismatches = local.findMismatches(remote.getTopN(2));

    expect(mismatches.length).toBeGreaterThan(0);
  });
});

describe('PrefixTrie.findMismatches (branch-snapshot rooting)', () => {
  const K1 = ('a5' + '0'.repeat(62)).slice(0, 64);
  const K2 = ('a51' + '0'.repeat(61)).slice(0, 64);

  it('reports no mismatch for a branch snapshot that is fully converged locally', () => {
    const local = new PrefixTrie(mockHashStrategy);
    const remote = new PrefixTrie(mockHashStrategy);
    for (const k of [K1, K2]) {
      local.insert(k);
      remote.insert(k);
    }

    // The 'a5' subtree is identical on both sides. A branch snapshot for 'a5' must
    // compare against the local 'a5' node — not the root — and report convergence.
    const branchSnapshot = remote.getBranches(['a5'], 2).a5;

    expect(local.findMismatches(branchSnapshot)).toEqual([]);
  });

  it('drills a branch snapshot toward a leaf the local trie is missing', () => {
    const missing = ('a5' + '9'.repeat(62)).slice(0, 64);
    const local = new PrefixTrie(mockHashStrategy);
    const remote = new PrefixTrie(mockHashStrategy);
    local.insert(K1);
    remote.insert(K1);
    remote.insert(missing); // remote-only key under the shared 'a5' branch

    const branchSnapshot = remote.getBranches(['a5'], 2).a5;
    const mismatches = local.findMismatches(branchSnapshot);

    expect(mismatches.length).toBeGreaterThan(0);
    // Every reported prefix points down the missing key's path, never the shared K1 path.
    for (const prefix of mismatches) {
      expect(missing.startsWith(prefix)).toBe(true);
    }
  });
});
