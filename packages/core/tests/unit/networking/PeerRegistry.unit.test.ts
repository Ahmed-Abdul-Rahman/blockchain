/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { NoopPeerRegistryMetrics } from '../../../src/metrics';
import { PeerRegistry, peerRegistry } from '../../../src/networking/PeerRegistry';
import { DeChatComponents } from '../../../src/types';

describe('PeerRegistry', () => {
  let mockComponents: Partial<DeChatComponents>;
  let registry: PeerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();

    // 1. Mock the DI Container
    mockComponents = {
      libp2p: {
        peerId: { toString: () => 'self-peer-id' },
      } as any,
      config: DECHAT_DEFAULTS,
      // Metrics are gracefully handled by Noop classes if missing,
      // but we can explicitly supply the Noop class for absolute safety
      metrics: { peerRegistry: new NoopPeerRegistryMetrics() } as any,
    };

    // 2. Instantiate using the Factory
    registry = peerRegistry()(mockComponents as DeChatComponents);
    registry.start();
  });

  afterEach(() => {
    registry.stop();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('upserts and retrieves candidates correctly', () => {
    registry.upsert({ peerId: 'peer-1', addresses: ['/ip4/127.0.0.1/tcp/0'] });
    registry.upsert({ peerId: 'peer-1', addresses: ['/ip4/127.0.0.1/tcp/1'] });

    const cands = registry.getCandidates(10);
    expect(cands.length).toBe(1);
    expect(new Set(cands[0].addresses).size).toBe(2);

    // simulate TTL expiry
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
    const cands2 = registry.getCandidates(10);

    // expired entries are filtered internally; result may be empty
    expect(cands2.length).toBe(0);
    nowSpy.mockRestore();
  });

  it('enforces PEX request cooldown', () => {
    registry.upsert({ peerId: 'p1', addresses: [] });
    expect(registry.isPeerDataRequested('p1')).toBe(true);

    registry.markRequested('p1');
    expect(registry.isPeerDataRequested('p1')).toBe(false);

    vi.advanceTimersByTime(DECHAT_DEFAULTS.peerRegistry.pexRequestCooldownMs + 100);
    expect(registry.isPeerDataRequested('p1')).toBe(true);
  });
});
