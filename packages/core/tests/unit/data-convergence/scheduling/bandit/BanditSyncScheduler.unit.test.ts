import { describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../../../src/config/defaults';
import { createAntiEntropyMetricsStore } from '../../../../../src/data-convergence/scheduling/AntiEntropyMetricsStore';
import { BanditSyncScheduler } from '../../../../../src/data-convergence/scheduling/bandit/BanditSyncScheduler';
import { EpsilonGreedyPolicy } from '../../../../../src/data-convergence/scheduling/bandit/EpsilonGreedyPolicy';
import { SyncTickContext } from '../../../../../src/data-convergence/scheduling/types';

const adaptiveConfig = {
  ...DECHAT_DEFAULTS.strategies.synchronizer.adaptive,
  enabled: true,
  scheduler: 'bandit' as const,
};

const mockPeer = (id: string) => ({ toString: () => id }) as never;

const tickContext = (overrides: Partial<SyncTickContext> = {}): SyncTickContext => ({
  now: Date.now(),
  timeSinceLastSyncMs: 0,
  timeSinceLastUsefulSyncMs: 0,
  consecutiveZeroHashComplete: 0,
  stateVector: [1, 0, 0, 0, 0, 0, 0],
  forceFloorSync: false,
  ...overrides,
});

describe('BanditSyncScheduler', () => {
  it('delegates idle skip and interval to the heuristic scheduler', () => {
    const metricsStore = createAntiEntropyMetricsStore(DECHAT_DEFAULTS.strategies.synchronizer);
    const scheduler = new BanditSyncScheduler(adaptiveConfig, metricsStore);

    const ctx = tickContext({
      consecutiveZeroHashComplete: adaptiveConfig.idleSkipStreak,
      stateVector: [1, 0, 0, 0, 0, 0, 0],
    });

    expect(scheduler.shouldSkipTick(ctx)).toBe(true);
    expect(scheduler.nextIntervalMs(tickContext())).toBeGreaterThan(0);
  });

  it('updates arm rewards after outbound sync completion', () => {
    const metricsStore = createAntiEntropyMetricsStore(DECHAT_DEFAULTS.strategies.synchronizer);
    const policy = new EpsilonGreedyPolicy(
      { epsilon: 0, epsilonDecayPerAttempts: 0, epsilonFloor: 0.05 },
      () => 1,
      (items) => ({ item: items[0], index: 0 }),
    );
    const scheduler = new BanditSyncScheduler(adaptiveConfig, metricsStore, policy);

    scheduler.pickPeer([mockPeer('peer-a'), mockPeer('peer-b')]);
    scheduler.onOutboundSyncComplete({
      peerId: 'peer-a',
      startedAt: Date.now(),
      durationMs: 50,
      result: { kind: 'complete', hashesDiscovered: 10, durationMs: 50 },
    });

    const snapshot = scheduler.getArmSnapshot().get('peer-a');
    expect(snapshot?.pulls).toBe(1);
    expect(snapshot?.averageReward).toBeCloseTo(0.6);
  });

  it('is created by createSyncScheduler when scheduler is bandit', async () => {
    const { createSyncScheduler } = await import('../../../../../src/data-convergence/scheduling');
    const metricsStore = createAntiEntropyMetricsStore({
      ...DECHAT_DEFAULTS.strategies.synchronizer,
      adaptive: { ...adaptiveConfig, scheduler: 'bandit' },
    });

    const scheduler = createSyncScheduler(
      {
        ...DECHAT_DEFAULTS.strategies.synchronizer,
        adaptive: { ...adaptiveConfig, scheduler: 'bandit' },
      },
      metricsStore,
    );

    expect(scheduler).toBeInstanceOf(BanditSyncScheduler);

    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const picked = scheduler.pickPeer([mockPeer('peer-a'), mockPeer('peer-b')]);
    expect(['peer-a', 'peer-b']).toContain(picked.toString());
    vi.mocked(Math.random).mockRestore();
  });
});
