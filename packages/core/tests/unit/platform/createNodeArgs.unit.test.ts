import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/createDeChatNode', () => ({
  createDeChatNode: vi.fn(
    async (_infoHash: string, _seed: string, options: { config?: unknown; strategies?: unknown }) => ({
      options,
      components: {},
      start: async () => undefined,
      stop: async () => undefined,
    }),
  ),
}));

vi.mock('../../../src/platform/createNodePlatformStack', () => ({
  createNodePlatformStack: vi.fn(() => ({
    transports: [],
    streamMuxers: [],
    connectionEncrypters: [],
    peerDiscovery: [],
    listenAddrs: [],
  })),
}));

import { createDeChatNode } from '../../../src/createDeChatNode';
import { createNode } from '../../../src/node';

describe('createNode argument normalization', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps PartialDeep config when it includes nested strategies (Compose / interop shape)', async () => {
    const strategyFactories = {
      broadcast: vi.fn(),
    };

    await createNode(
      'net',
      'seed',
      {
        network: {
          listenAddrs: ['/ip4/0.0.0.0/tcp/4001'],
          bootstrapPeers: [],
        },
        discovery: { enableMdns: false },
        strategies: {
          synchronizer: {
            syncIntervalMs: 15_000,
            adaptive: { enabled: true, scheduler: 'heuristic' },
          },
        },
      },
      strategyFactories as never,
    );

    expect(createDeChatNode).toHaveBeenCalledOnce();
    const [, , options] = vi.mocked(createDeChatNode).mock.calls[0]!;
    expect(options.config).toMatchObject({
      network: { listenAddrs: ['/ip4/0.0.0.0/tcp/4001'] },
      strategies: { synchronizer: { syncIntervalMs: 15_000 } },
    });
    expect(options.strategies).toBe(strategyFactories);
  });

  it('accepts explicit options bag with config + strategies factories', async () => {
    const strategyFactories = { broadcast: vi.fn() };
    await createNode('net', 'seed', {
      config: { discovery: { enableMdns: false } },
      strategies: strategyFactories as never,
    });

    const [, , options] = vi.mocked(createDeChatNode).mock.calls[0]!;
    expect(options.config).toMatchObject({ discovery: { enableMdns: false } });
    expect(options.strategies).toBe(strategyFactories);
  });
});
