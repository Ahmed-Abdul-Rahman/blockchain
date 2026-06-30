import { describe, expect, it, vi } from 'vitest';
import { FixedSyncScheduler } from '../../../../src/data-convergence/scheduling/FixedSyncScheduler';
import { SyncTickContext } from '../../../../src/data-convergence/scheduling/types';

const mockPeer = (id: string) => ({ toString: () => id }) as never;

const tickContext = (overrides: Partial<SyncTickContext> = {}): SyncTickContext => ({
  now: Date.now(),
  timeSinceLastSyncMs: 0,
  timeSinceLastUsefulSyncMs: 0,
  consecutiveZeroHashComplete: 0,
  stateVector: [0, 0, 0, 0, 0, 0, 0],
  forceFloorSync: false,
  ...overrides,
});

describe('FixedSyncScheduler', () => {
  it('never skips ticks', () => {
    const scheduler = new FixedSyncScheduler(60_000);
    expect(scheduler.shouldSkipTick(tickContext())).toBe(false);
    expect(scheduler.shouldSkipTick(tickContext({ consecutiveZeroHashComplete: 10 }))).toBe(false);
  });

  it('returns fixed interval regardless of context', () => {
    const scheduler = new FixedSyncScheduler(30_000);
    expect(scheduler.nextIntervalMs(tickContext())).toBe(30_000);
  });

  it('picks peers uniformly at random', () => {
    const pickRandom = vi.fn().mockReturnValue({ item: mockPeer('peer-2'), index: 1 });
    const scheduler = new FixedSyncScheduler(60_000, pickRandom);
    const candidates = [mockPeer('peer-1'), mockPeer('peer-2')];

    scheduler.pickPeer(candidates);
    expect(pickRandom).toHaveBeenCalledWith(candidates);
  });

  it('onOutboundSyncComplete is a no-op', () => {
    const scheduler = new FixedSyncScheduler(60_000);
    expect(() =>
      scheduler.onOutboundSyncComplete({
        peerId: 'p',
        startedAt: 0,
        durationMs: 0,
        result: { kind: 'failed', durationMs: 0 },
      }),
    ).not.toThrow();
  });
});
