/** biome-ignore-all lint/suspicious/noExplicitAny: test file */
import { logger } from '@dechat/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { AntiEntropyManager, antiEntropyManager } from '../../../src/data-convergence/AntiEntropyManager';
import { SyncAttemptRecord } from '../../../src/data-convergence/scheduling/types';
import { NoopAntiEntropyMetrics } from '../../../src/metrics/noop/NoopAntiEntropyMetrics';
import { DeChatComponents } from '../../../src/types';

const peer = (id: string) => ({ toString: () => id }) as any;

const completeEmpty = () => ({ status: 'complete' as const, hashes: [] as string[] });

const adaptiveSynchronizerConfig = (adaptiveOverrides: Record<string, unknown> = {}) => ({
  ...DECHAT_DEFAULTS.strategies.synchronizer,
  syncIntervalMs: 60_000,
  retry: { maxRetries: 0, baseBackoffMs: 10, maxBackoffMs: 50 },
  adaptive: {
    ...DECHAT_DEFAULTS.strategies.synchronizer.adaptive,
    enabled: true,
    scheduler: 'heuristic' as const,
    minIntervalMs: 1_000,
    maxIntervalMs: 10_000,
    jitterMs: 0,
    idleSkipStreak: 3,
    idleActivityThreshold: 0.05,
    ...adaptiveOverrides,
  },
});

const buildManager = (
  synchronizerConfig: ReturnType<typeof adaptiveSynchronizerConfig>,
  connections: Array<{ remotePeer: ReturnType<typeof peer> }>,
): { manager: AntiEntropyManager; mockExchange: { syncWithPeer: ReturnType<typeof vi.fn> } } => {
  const mockExchange = {
    syncWithPeer: vi.fn().mockResolvedValue(completeEmpty()),
    onMissingHashesDiscovered: undefined,
  };
  const mockComponents: Partial<DeChatComponents> = {
    libp2p: { getConnections: vi.fn().mockReturnValue(connections) } as any,
    config: { strategies: { synchronizer: synchronizerConfig } } as DeChatComponents['config'],
    metrics: { antiEntropy: new NoopAntiEntropyMetrics() } as DeChatComponents['metrics'],
    strategies: {
      dataReplication: { requestMissingData: vi.fn().mockResolvedValue(undefined) },
      networkExchanger: mockExchange,
    } as any,
  };

  const manager = antiEntropyManager()(mockComponents as DeChatComponents);
  return { manager, mockExchange };
};

const recordAttempt = (peerId: string, hashesDiscovered: number): SyncAttemptRecord => ({
  peerId,
  startedAt: Date.now(),
  durationMs: 50,
  result: { kind: 'complete', hashesDiscovered, durationMs: 50 },
});

/** Advance fake timers through one scheduled tick (interval + microtasks). */
const advanceOneTick = async (intervalMs: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(intervalMs);
};

/** Run N consecutive zero-hash outbound syncs via the scheduled path. */
const runZeroHashSyncs = async (
  manager: AntiEntropyManager,
  mockExchange: { syncWithPeer: ReturnType<typeof vi.fn> },
  count: number,
): Promise<void> => {
  mockExchange.syncWithPeer.mockResolvedValue(completeEmpty());
  for (let i = 0; i < count; i++) {
    await (manager as any).performScheduledSync();
  }
};

describe('AntiEntropyManager (adaptive scheduling)', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('skips scheduled ticks after consecutive zero-hash syncs when room is idle', async () => {
    const { manager, mockExchange } = buildManager(adaptiveSynchronizerConfig(), [{ remotePeer: peer('peer-1') }]);
    manager.start();

    await runZeroHashSyncs(manager, mockExchange, 3);
    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(3);

    mockExchange.syncWithPeer.mockClear();
    await (manager as any).performScheduledSync();

    expect(mockExchange.syncWithPeer).not.toHaveBeenCalled();
    const snap = (manager as any).metricsStore.snapshot();
    expect(snap.skipCounts.idle_skip).toBeGreaterThanOrEqual(1);
    expect(snap.consecutiveZeroHashComplete).toBeGreaterThanOrEqual(3);
    expect(debugSpy.mock.calls.some(([m]) => String(m).includes('mode=heuristic') && String(m).includes('idle'))).toBe(
      true,
    );

    manager.stop();
  });

  it('forces floor sync after maxIntervalMs even when idle skip would apply', async () => {
    const maxIntervalMs = 10_000;
    const { manager, mockExchange } = buildManager(adaptiveSynchronizerConfig({ maxIntervalMs }), [
      { remotePeer: peer('peer-1') },
    ]);
    manager.start();

    await runZeroHashSyncs(manager, mockExchange, 3);
    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(3);

    mockExchange.syncWithPeer.mockClear();
    await (manager as any).performScheduledSync();
    expect(mockExchange.syncWithPeer).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-01-01T00:00:13.001Z'));
    mockExchange.syncWithPeer.mockClear();
    await (manager as any).performScheduledSync();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(1);
    const snap = (manager as any).metricsStore.snapshot();
    expect(snap.skipCounts.floor_sync_forced).toBeGreaterThanOrEqual(1);
    expect(debugSpy.mock.calls.some(([m]) => String(m).includes('Floor sync override'))).toBe(true);

    manager.stop();
  });

  it('schedules shorter intervals under high replication activity than when dormant', () => {
    const { manager } = buildManager(adaptiveSynchronizerConfig({ jitterMs: 0 }), [{ remotePeer: peer('peer-1') }]);
    const scheduler = (manager as any).scheduler;

    const baseCtx = {
      now: Date.now(),
      timeSinceLastSyncMs: 1_000,
      timeSinceLastUsefulSyncMs: 1_000,
      consecutiveZeroHashComplete: 3,
      forceFloorSync: false,
    };

    const dormantDelay = scheduler.nextIntervalMs({
      ...baseCtx,
      stateVector: [1, 0, 0, 0.1, 1, 0, 0],
    });
    const activeDelay = scheduler.nextIntervalMs({
      ...baseCtx,
      stateVector: [1, 0, 0, 0.1, 1, 0.9, 0],
    });

    expect(activeDelay).toBeLessThan(dormantDelay);
    expect(dormantDelay).toBeGreaterThanOrEqual(10_000);
    expect(activeDelay).toBeLessThanOrEqual(2_000);
  });

  it('picks the higher-convergence peer when adaptive scheduler is enabled', async () => {
    const goodPeer = peer('good-peer');
    const badPeer = peer('bad-peer');
    const { manager, mockExchange } = buildManager(adaptiveSynchronizerConfig(), [
      { remotePeer: badPeer },
      { remotePeer: goodPeer },
    ]);

    const metricsStore = (manager as any).metricsStore;
    metricsStore.recordOutboundAttempt(recordAttempt('good-peer', 10));
    metricsStore.recordOutboundAttempt({
      peerId: 'bad-peer',
      startedAt: Date.now(),
      durationMs: 50,
      result: { kind: 'failed', durationMs: 50 },
    });

    vi.spyOn(Math, 'random').mockReturnValue(0.95);

    await (manager as any).performScheduledSync();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledWith(goodPeer);
    expect(
      debugSpy.mock.calls.some(([m]) => String(m).includes('mode=heuristic') && String(m).includes('good-peer')),
    ).toBe(true);

    vi.mocked(Math.random).mockRestore();
  });

  it('logs fixed mode in schedule decisions when adaptive is disabled', async () => {
    const fixedConfig = {
      ...adaptiveSynchronizerConfig(),
      adaptive: { ...adaptiveSynchronizerConfig().adaptive, enabled: false },
      syncIntervalMs: 2_000,
    };
    const { manager } = buildManager(fixedConfig, [{ remotePeer: peer('peer-1') }]);
    manager.start();

    await advanceOneTick(2_000);

    expect(
      debugSpy.mock.calls.some(([m]) => String(m).includes('mode=fixed') && String(m).includes('Scheduling next tick')),
    ).toBe(true);

    manager.stop();
  });

  it('uses dynamic setTimeout delays rather than a fixed interval when adaptive is enabled', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager } = buildManager(adaptiveSynchronizerConfig({ jitterMs: 0 }), [{ remotePeer: peer('peer-1') }]);
    manager.start();

    const scheduleLog = debugSpy.mock.calls.find(([m]) => String(m).includes('Scheduling next tick'));
    expect(scheduleLog).toBeDefined();
    expect(String(scheduleLog?.[0])).toContain('mode=heuristic');

    const scheduler = (manager as any).scheduler;
    const fixedDelay = 15_000;
    const adaptiveDelay = scheduler.nextIntervalMs({
      now: Date.now(),
      timeSinceLastSyncMs: 1_000,
      timeSinceLastUsefulSyncMs: 1_000,
      consecutiveZeroHashComplete: 0,
      forceFloorSync: false,
      stateVector: [1, 0, 0, 0.1, 1, 0.8, 0],
    });

    expect(adaptiveDelay).toBeLessThan(fixedDelay);

    manager.stop();
    vi.mocked(Math.random).mockRestore();
  });
});
