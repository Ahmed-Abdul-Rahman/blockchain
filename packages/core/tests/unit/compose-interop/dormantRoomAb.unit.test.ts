import { describe, expect, it } from 'vitest';
import {
  assertWanWithinLanMultiplier,
  mergeComposeAbReports,
  parseComposeTestReport,
} from '../../compose-interop/scenarios/dormant-room-ab';
import type { AntiEntropyInteropSummary, Summary, TestReport } from '../../interop/types';

const emptySummary = (): Summary => ({
  nodes: 7,
  connections: { p50: 1, p95: 1, avg: 1 },
  verified: { p50: 1, p95: 1, avg: 1 },
  ttfVerifiedMs: { p50: 1, p95: 1, avg: 1 },
});

const antiEntropy = (idleSkips: number): AntiEntropyInteropSummary => ({
  lateJoiner: {
    usefulSyncs: 1,
    outboundAttempts: 2,
    lastSyncHashes: 3,
    idleSkips: 0,
    floorSyncForces: 0,
    scheduledTicks: 4,
    convergenceMs: 12_000,
  },
  producerIdleSkipsTotal: idleSkips,
  producerOutboundAttemptsTotal: 10,
  producerFloorSyncForcesTotal: 0,
  producerScheduledTicksTotal: 20,
});

const makeReport = (overrides: Partial<TestReport> & { idleSkips: number }): TestReport => {
  const { idleSkips, ...rest } = overrides;
  return {
    testName: 'compose-late-joiner-adaptive',
    totalNodes: 7,
    duration: 60,
    summary: emptySummary(),
    passed: true,
    timestamp: '2026-07-18T00:00:00.000Z',
    scenarioWallMs: 90_000,
    antiEntropy: antiEntropy(idleSkips),
    ...rest,
  };
};

describe('compose dormant-room A/B merge', () => {
  it('merges fixed/heuristic reports when heuristic idle-skips more', () => {
    const result = mergeComposeAbReports({
      fixedReport: makeReport({ idleSkips: 0 }),
      heuristicReport: makeReport({ idleSkips: 8, scenarioWallMs: 95_000 }),
    });

    expect(result.passed).toBe(true);
    expect(result.abComparison.fixed.producerIdleSkipsTotal).toBe(0);
    expect(result.abComparison.heuristic.producerIdleSkipsTotal).toBe(8);
    expect(result.abComparison.fixedWallMs).toBe(90_000);
    expect(result.abComparison.heuristicWallMs).toBe(95_000);
    expect(result.report.testName).toBe('compose-dormant-room-ab');
  });

  it('rejects when heuristic does not idle-skip more than fixed', () => {
    expect(() =>
      mergeComposeAbReports({
        fixedReport: makeReport({ idleSkips: 5 }),
        heuristicReport: makeReport({ idleSkips: 5 }),
      }),
    ).toThrow(/idle-skip/);
  });

  it('rejects a failed leg', () => {
    expect(() =>
      mergeComposeAbReports({
        fixedReport: makeReport({ idleSkips: 0, passed: false }),
        heuristicReport: makeReport({ idleSkips: 3 }),
      }),
    ).toThrow(/Fixed/);
  });

  it('parses a minimal valid report JSON', () => {
    const parsed = parseComposeTestReport({
      testName: 'x',
      totalNodes: 3,
      duration: 1,
      summary: emptySummary(),
      passed: true,
      timestamp: 't',
    });
    expect(parsed.testName).toBe('x');
  });
});

describe('assertWanWithinLanMultiplier', () => {
  it('accepts wan within 2× lan', () => {
    expect(() => assertWanWithinLanMultiplier(100_000, 180_000, 2)).not.toThrow();
  });

  it('rejects wan above multiplier', () => {
    expect(() => assertWanWithinLanMultiplier(100_000, 250_000, 2)).toThrow(/exceeds/);
  });
});
