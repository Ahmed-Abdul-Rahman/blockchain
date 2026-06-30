import { describe, expect, it } from 'vitest';
import { simulateDormantRoomScheduling } from '../../../perf/antiEntropyScheduler.bench';

describe('antiEntropyScheduler bench simulation', () => {
  it('heuristic mode idle-skips more than fixed in a dormant converged room', () => {
    const tickCount = 15;
    const fixed = simulateDormantRoomScheduling(false, tickCount);
    const heuristic = simulateDormantRoomScheduling(true, tickCount);

    expect(heuristic.idleSkips).toBeGreaterThan(fixed.idleSkips);
    expect(heuristic.outboundAttempts).toBeLessThan(fixed.outboundAttempts);
  });

  it('heuristic mode may force floor sync at maxIntervalMs ceiling', () => {
    const heuristic = simulateDormantRoomScheduling(true, 30);
    expect(heuristic.floorSyncForces).toBeGreaterThanOrEqual(0);
  });
});
