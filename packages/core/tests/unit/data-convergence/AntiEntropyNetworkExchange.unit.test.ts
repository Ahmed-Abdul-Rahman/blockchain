/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { antiEntropyNetworkExchangeEngine } from '../../../src/data-convergence/AntiEntropyNetworkExchange';
import { PrefixTrie } from '../../../src/data-convergence/PrefixTrie';
import { AntiEntropyMessage, TrieNodeSnapshot } from '../../../src/data-convergence/types';
import { ContentHashStrategyInterface } from '../../../src/data-replication/content-hash/types';
import { DeChatComponents } from '../../../src/types';

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

const LEAF = 'a'.repeat(64);

// A Top-N snapshot whose 'a' branch the (empty) local trie is missing, so the flow
// will issue a REQUEST_BRANCHES for prefix 'a'.
const topNWithMissingBranchA: TrieNodeSnapshot = {
  prefix: '',
  hash: 'REMOTE_ROOT',
  children: { a: { prefix: 'a', hash: 'REMOTE_A' } },
};

describe('AntiEntropyNetworkExchange.executeSyncFlow (branch drill-down robustness)', () => {
  let exchange: any;
  let localTrie: PrefixTrie;

  beforeEach(() => {
    localTrie = new PrefixTrie(mockHashStrategy); // empty: everything remote is "missing"
    const components = {
      libp2p: {} as any,
      config: { strategies: { synchronizer: { protocol: '/test/anti-entropy/1.0.0' } } } as any,
      strategies: { prefixTrie: localTrie } as any,
    } as Partial<DeChatComponents>;

    exchange = antiEntropyNetworkExchangeEngine()(components as DeChatComponents);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const run = (sendRequest: (m: AntiEntropyMessage) => Promise<AntiEntropyMessage>) =>
    exchange.executeSyncFlow(sendRequest);

  it('returns partial(badResponse) when a requested branch prefix is dropped from the response', async () => {
    const sendRequest = vi.fn(async (msg: AntiEntropyMessage): Promise<AntiEntropyMessage> => {
      if (msg.type === 'REQUEST_TOP_N') return { type: 'RESPONSE_TOP_N', snapshot: topNWithMissingBranchA };
      // Responder DROPS the requested 'a' prefix (returns an empty map).
      return { type: 'RESPONSE_BRANCHES', branches: {} };
    });

    const outcome = await run(sendRequest);

    expect(outcome).toEqual({ status: 'partial', hashes: [], reason: 'badResponse' });
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  it('completes (nothing to pull) when a requested branch comes back as an empty marker', async () => {
    const sendRequest = vi.fn(async (msg: AntiEntropyMessage): Promise<AntiEntropyMessage> => {
      if (msg.type === 'REQUEST_TOP_N') return { type: 'RESPONSE_TOP_N', snapshot: topNWithMissingBranchA };
      // Responder explicitly says "no data under 'a'" via an empty-hash snapshot.
      return { type: 'RESPONSE_BRANCHES', branches: { a: { prefix: 'a', hash: '' } } };
    });

    const outcome = await run(sendRequest);

    expect(outcome).toEqual({ status: 'complete', hashes: [] });
  });

  it('drills a populated branch down to the missing leaf hash', async () => {
    const sendRequest = vi.fn(async (msg: AntiEntropyMessage): Promise<AntiEntropyMessage> => {
      if (msg.type === 'REQUEST_TOP_N') return { type: 'RESPONSE_TOP_N', snapshot: topNWithMissingBranchA };
      return {
        type: 'RESPONSE_BRANCHES',
        branches: {
          a: { prefix: 'a', hash: 'REMOTE_A', children: { x: { prefix: LEAF, hash: LEAF } } },
        },
      };
    });

    const outcome = await run(sendRequest);

    expect(outcome).toEqual({ status: 'complete', hashes: [LEAF] });
  });

  it('returns complete with no hashes when already converged at the top level', async () => {
    // Local mirrors a single remote key; the Top-N hashes will match.
    localTrie.insert(LEAF);
    const matchingTopN = localTrie.getTopN(2);

    const sendRequest = vi.fn(async (msg: AntiEntropyMessage): Promise<AntiEntropyMessage> => {
      if (msg.type === 'REQUEST_TOP_N') return { type: 'RESPONSE_TOP_N', snapshot: matchingTopN };
      return { type: 'RESPONSE_BRANCHES', branches: {} };
    });

    const outcome = await run(sendRequest);

    expect(outcome).toEqual({ status: 'complete', hashes: [] });
    expect(sendRequest).toHaveBeenCalledTimes(1); // no drill-down needed
  });

  // A responder backed by a real remote trie — exercises the full multi-round drill-down
  // (Top-N then iterative branch requests) end to end, validating the branch-rooting fix.
  const makeResponder = (remote: PrefixTrie) =>
    vi.fn(async (msg: AntiEntropyMessage): Promise<AntiEntropyMessage> => {
      if (msg.type === 'REQUEST_TOP_N') return { type: 'RESPONSE_TOP_N', snapshot: remote.getTopN(msg.levels) };
      if (msg.type === 'REQUEST_BRANCHES') {
        return { type: 'RESPONSE_BRANCHES', branches: remote.getBranches(msg.prefixes, 2) };
      }
      throw new Error('unexpected message');
    });

  it('discovers exactly the remote-only leaf under a shared branch (real responder)', async () => {
    const shared = ('a5' + '0'.repeat(62)).slice(0, 64);
    const missing = ('a5' + '9'.repeat(62)).slice(0, 64);

    localTrie.insert(shared); // exchange.this.trie holds only the shared key
    const remote = new PrefixTrie(mockHashStrategy);
    remote.insert(shared);
    remote.insert(missing); // remote additionally has `missing` under the shared 'a5' branch

    const outcome = await run(makeResponder(remote));

    expect(outcome).toEqual({ status: 'complete', hashes: [missing] });
  });

  it('converges with no missing hashes when both tries are identical (real responder)', async () => {
    const k1 = ('a5' + '0'.repeat(62)).slice(0, 64);
    const k2 = ('b3' + '0'.repeat(62)).slice(0, 64);

    const remote = new PrefixTrie(mockHashStrategy);
    for (const k of [k1, k2]) {
      localTrie.insert(k);
      remote.insert(k);
    }

    const outcome = await run(makeResponder(remote));

    expect(outcome).toEqual({ status: 'complete', hashes: [] });
  });
});
