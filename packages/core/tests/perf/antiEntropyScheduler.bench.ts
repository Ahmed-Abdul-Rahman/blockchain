import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECHAT_DEFAULTS } from '../../src/config/defaults';
import { DeChatConfig } from '../../src/config/types';
import { createAntiEntropyMetricsStore, createSyncScheduler } from '../../src/data-convergence/scheduling';
import { SyncAttemptRecord, SyncTickContext } from '../../src/data-convergence/scheduling/types';
import { formatNumber } from './lib/benchUtils';

/** Result of simulating anti-entropy scheduling over a dormant-room scenario */
export interface SchedulerSimResult {
  /** Scheduler mode label */
  readonly mode: 'fixed' | 'heuristic';

  /** Total scheduled tick evaluations */
  readonly scheduledTicks: number;

  /** Outbound sync attempts that would have run (not skipped) */
  readonly outboundAttempts: number;

  /** Ticks skipped due to idle dormancy */
  readonly idleSkips: number;

  /** Ticks where floor sync overrode idle skip */
  readonly floorSyncForces: number;

  /** Sum of computed next-interval delays (ms) */
  readonly totalIntervalMs: number;
}

/** Full A/B report comparing fixed vs heuristic scheduling */
export interface AntiEntropySchedulerBenchReport {
  readonly timestamp: string;
  readonly scenario: string;
  readonly tickCount: number;
  readonly fixed: SchedulerSimResult;
  readonly heuristic: SchedulerSimResult;
}

type SynchronizerConfig = DeChatConfig['strategies']['synchronizer'];

const buildConfig = (adaptiveEnabled: boolean): SynchronizerConfig => ({
  ...DECHAT_DEFAULTS.strategies.synchronizer,
  syncIntervalMs: 15_000,
  adaptive: {
    ...DECHAT_DEFAULTS.strategies.synchronizer.adaptive,
    enabled: adaptiveEnabled,
    scheduler: adaptiveEnabled ? 'heuristic' : 'fixed',
    minIntervalMs: 5_000,
    maxIntervalMs: 60_000,
    jitterMs: 0,
    idleSkipStreak: 3,
  },
});

const buildTickContext = (
  store: ReturnType<typeof createAntiEntropyMetricsStore>,
  now: number,
  maxIntervalMs: number,
  adaptiveEnabled: boolean,
): SyncTickContext => {
  const timeSinceLastSyncMs = store.getTimeSinceLastSyncMs(now);
  return {
    now,
    timeSinceLastSyncMs,
    timeSinceLastUsefulSyncMs: store.getTimeSinceLastUsefulSyncMs(now),
    consecutiveZeroHashComplete: store.getConsecutiveZeroHashComplete(),
    stateVector: store.getStateVector(now),
    forceFloorSync: adaptiveEnabled && timeSinceLastSyncMs >= maxIntervalMs,
  };
};

const recordZeroHashComplete = (store: ReturnType<typeof createAntiEntropyMetricsStore>, peerId: string): void => {
  const record: SyncAttemptRecord = {
    peerId,
    startedAt: Date.now(),
    durationMs: 100,
    result: { kind: 'complete', hashesDiscovered: 0, durationMs: 100 },
  };
  store.recordOutboundAttempt(record);
};

/**
 * Simulates a converged dormant room: K zero-hash syncs then many scheduling ticks
 * without new replication activity.
 */
export const simulateDormantRoomScheduling = (adaptiveEnabled: boolean, tickCount: number): SchedulerSimResult => {
  const config = buildConfig(adaptiveEnabled);
  const store = createAntiEntropyMetricsStore(config);
  const scheduler = createSyncScheduler(config, store);
  const maxIntervalMs = config.adaptive.maxIntervalMs ?? config.syncIntervalMs;

  let now = Date.UTC(2026, 0, 1);
  let scheduledTicks = 0;
  let outboundAttempts = 0;
  let idleSkips = 0;
  let floorSyncForces = 0;
  let totalIntervalMs = 0;

  // Bootstrap: three converged syncs (zero hashes) to enter dormant state.
  for (let i = 0; i < config.adaptive.idleSkipStreak; i++) {
    recordZeroHashComplete(store, 'peer-1');
    now += 15_000;
  }

  let elapsedSinceLastSync = 0;

  for (let tick = 0; tick < tickCount; tick++) {
    scheduledTicks++;
    const ctx = buildTickContext(store, now, maxIntervalMs, adaptiveEnabled);
    const delayMs = scheduler.nextIntervalMs(ctx);
    totalIntervalMs += delayMs;

    const wouldSkip = scheduler.shouldSkipTick(ctx) && !ctx.forceFloorSync;
    if (wouldSkip) {
      idleSkips++;
      store.recordSkip('idle_skip');
    } else {
      if (ctx.forceFloorSync && scheduler.shouldSkipTick(ctx)) {
        floorSyncForces++;
        store.recordSkip('floor_sync_forced');
      }
      outboundAttempts++;
      recordZeroHashComplete(store, 'peer-1');
      elapsedSinceLastSync = 0;
    }

    now += delayMs;
    elapsedSinceLastSync += delayMs;
  }

  return {
    mode: adaptiveEnabled ? 'heuristic' : 'fixed',
    scheduledTicks,
    outboundAttempts,
    idleSkips,
    floorSyncForces,
    totalIntervalMs,
  };
};

/** Run fixed vs heuristic A/B simulation and produce a markdown report */
export const runAntiEntropySchedulerBenchmark = (tickCount = 20): AntiEntropySchedulerBenchReport => {
  const fixed = simulateDormantRoomScheduling(false, tickCount);
  const heuristic = simulateDormantRoomScheduling(true, tickCount);

  return {
    timestamp: new Date().toISOString(),
    scenario: 'dormant-room-after-convergence',
    tickCount,
    fixed,
    heuristic,
  };
};

const renderReportMarkdown = (report: AntiEntropySchedulerBenchReport): string => {
  const { fixed, heuristic } = report;
  const attemptReduction =
    fixed.outboundAttempts > 0
      ? ((fixed.outboundAttempts - heuristic.outboundAttempts) / fixed.outboundAttempts) * 100
      : 0;

  return `# Anti-Entropy Scheduler A/B Report

Generated: ${report.timestamp}

Scenario: **${report.scenario}** (${report.tickCount} scheduling ticks after ${DECHAT_DEFAULTS.strategies.synchronizer.adaptive.idleSkipStreak} zero-hash syncs)

| Metric | Fixed | Heuristic | Delta |
| --- | ---: | ---: | ---: |
| Outbound attempts | ${fixed.outboundAttempts} | ${heuristic.outboundAttempts} | ${formatNumber(heuristic.outboundAttempts - fixed.outboundAttempts, 0)} |
| Idle skips | ${fixed.idleSkips} | ${heuristic.idleSkips} | ${formatNumber(heuristic.idleSkips - fixed.idleSkips, 0)} |
| Floor sync overrides | ${fixed.floorSyncForces} | ${heuristic.floorSyncForces} | ${formatNumber(heuristic.floorSyncForces - fixed.floorSyncForces, 0)} |
| Total interval (ms) | ${fixed.totalIntervalMs} | ${heuristic.totalIntervalMs} | ${formatNumber(heuristic.totalIntervalMs - fixed.totalIntervalMs, 0)} |

**Attempt reduction (heuristic vs fixed):** ${formatNumber(attemptReduction, 1)}%

## Interpretation

- **Idle skips > 0 (heuristic only)** confirms dormant-room skip policy is active.
- **Lower outbound attempts (heuristic)** confirms bandwidth savings vs fixed polling.
- **Floor sync overrides > 0 (heuristic)** confirms eventual-consistency ceiling is enforced.
`;
};

export const printAntiEntropySchedulerBenchSummary = (report: AntiEntropySchedulerBenchReport): void => {
  console.log(renderReportMarkdown(report));
};

export const writeAntiEntropySchedulerBenchReport = (report: AntiEntropySchedulerBenchReport): string => {
  const reportsDir = resolve(import.meta.dirname, 'reports');
  const latestPath = resolve(reportsDir, 'anti-entropy-scheduler-report-latest.md');
  const timestampPath = resolve(
    reportsDir,
    `anti-entropy-scheduler-report-${report.timestamp.replace(/[:.]/g, '-')}.md`,
  );
  const markdown = renderReportMarkdown(report);

  writeFileSync(latestPath, markdown, 'utf8');
  writeFileSync(timestampPath, markdown, 'utf8');
  console.log(`Report written to ${latestPath}`);
  return latestPath;
};
