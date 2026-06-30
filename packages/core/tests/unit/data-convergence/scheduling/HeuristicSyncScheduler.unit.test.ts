import { describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../../src/config/defaults';
import { HeuristicSyncScheduler } from '../../../../src/data-convergence/scheduling/HeuristicSyncScheduler';
import { PeerConvergenceTracker } from '../../../../src/data-convergence/scheduling/PeerConvergenceTracker';
import { SyncTickContext } from '../../../../src/data-convergence/scheduling/types';

const adaptiveConfig = {
  ...DECHAT_DEFAULTS.strategies.synchronizer.adaptive,
  enabled: true,
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

describe('HeuristicSyncScheduler', () => {
  it('skips tick when idle streak met and activity is below threshold', () => {
    const tracker = new PeerConvergenceTracker(adaptiveConfig.peerConvergence);
    const scheduler = new HeuristicSyncScheduler(adaptiveConfig, tracker);

    const ctx = tickContext({
      consecutiveZeroHashComplete: adaptiveConfig.idleSkipStreak,
      stateVector: [1, 0, 0, 0, 0, 0, 0], // replicationActivityRate = 0
    });

    expect(scheduler.shouldSkipTick(ctx)).toBe(true);
  });

  it('does not skip when forceFloorSync is set', () => {
    const tracker = new PeerConvergenceTracker(adaptiveConfig.peerConvergence);
    const scheduler = new HeuristicSyncScheduler(adaptiveConfig, tracker);

    const ctx = tickContext({
      consecutiveZeroHashComplete: 10,
      forceFloorSync: true,
      stateVector: [1, 0, 0, 0, 0, 0, 0],
    });

    expect(scheduler.shouldSkipTick(ctx)).toBe(false);
  });

  it('does not skip when replication activity is above threshold', () => {
    const tracker = new PeerConvergenceTracker(adaptiveConfig.peerConvergence);
    const scheduler = new HeuristicSyncScheduler(adaptiveConfig, tracker);

    const ctx = tickContext({
      consecutiveZeroHashComplete: 10,
      stateVector: [1, 0, 0, 0, 0, 0.1, 0], // activity > 0.05
    });

    expect(scheduler.shouldSkipTick(ctx)).toBe(false);
  });

  it('returns interval within min/max bounds with jitter', () => {
    const tracker = new PeerConvergenceTracker(adaptiveConfig.peerConvergence);
    const scheduler = new HeuristicSyncScheduler(adaptiveConfig, tracker);

    vi.spyOn(Math, 'random').mockReturnValue(0);

    const lowUrgency = scheduler.nextIntervalMs(tickContext({ stateVector: [1, 0, 0, 0, 1, 0, 0] }));
    expect(lowUrgency).toBeGreaterThanOrEqual(adaptiveConfig.maxIntervalMs);
    expect(lowUrgency).toBeLessThanOrEqual(adaptiveConfig.maxIntervalMs + adaptiveConfig.jitterMs);

    const highUrgency = scheduler.nextIntervalMs(tickContext({ stateVector: [0, 1, 1, 1, 1, 1, 1] }));
    expect(highUrgency).toBeGreaterThanOrEqual(adaptiveConfig.minIntervalMs);
    expect(highUrgency).toBeLessThanOrEqual(adaptiveConfig.minIntervalMs + adaptiveConfig.jitterMs);

    vi.mocked(Math.random).mockRestore();
  });

  it('prefers peers with higher convergence scores', () => {
    const tracker = new PeerConvergenceTracker(adaptiveConfig.peerConvergence);
    tracker.onUsefulSync('good-peer', 10);
    tracker.onFailedSync('bad-peer');

    const scheduler = new HeuristicSyncScheduler(adaptiveConfig, tracker);
    const candidates = [mockPeer('bad-peer'), mockPeer('good-peer')];

    // Random value in the upper range selects the higher-weight peer
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    expect(scheduler.pickPeer(candidates).toString()).toBe('good-peer');
    vi.mocked(Math.random).mockRestore();
  });
});
