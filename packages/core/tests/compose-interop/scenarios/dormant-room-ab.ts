/**
 * Host-side A/B merge for Compose late-joiner dual runs (fixed vs heuristic).
 * Does not start Docker — `run-ab.sh` produces the two input reports.
 */
import assert from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '@dechat/common';
import { generateTestReport, printTestReport } from '../../interop/interopTestReporter';
import type { AbComparisonReport, AntiEntropyInteropSummary, TestReport } from '../../interop/types';

export type ComposeAbInputs = {
  readonly fixedReport: TestReport;
  readonly heuristicReport: TestReport;
};

export type ComposeAbMergeResult = {
  readonly passed: boolean;
  readonly abComparison: AbComparisonReport;
  readonly report: TestReport;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAntiEntropySummary = (value: unknown): value is AntiEntropyInteropSummary => {
  if (!isRecord(value)) return false;
  return (
    typeof value.producerIdleSkipsTotal === 'number' &&
    typeof value.producerOutboundAttemptsTotal === 'number' &&
    typeof value.producerFloorSyncForcesTotal === 'number' &&
    typeof value.producerScheduledTicksTotal === 'number'
  );
};

/** Parse a Compose/interop TestReport JSON written by late-joiner-adaptive. */
export const parseComposeTestReport = (raw: unknown): TestReport => {
  if (!isRecord(raw)) {
    throw new Error('Report must be a JSON object');
  }
  if (typeof raw.testName !== 'string' || typeof raw.totalNodes !== 'number' || typeof raw.passed !== 'boolean') {
    throw new Error('Report missing required fields (testName, totalNodes, passed)');
  }
  if (!isRecord(raw.summary)) {
    throw new Error('Report missing summary');
  }
  return raw as unknown as TestReport;
};

export const loadComposeTestReport = (path: string): TestReport => {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parseComposeTestReport(raw);
};

/**
 * Merge fixed + heuristic Compose late-joiner reports and assert idle-skip A/B.
 * Both legs must have passed; heuristic producers must idle-skip more than fixed.
 */
export const mergeComposeAbReports = (inputs: ComposeAbInputs): ComposeAbMergeResult => {
  const { fixedReport, heuristicReport } = inputs;

  assert.ok(fixedReport.passed, 'Fixed Compose late-joiner report must be passed');
  assert.ok(heuristicReport.passed, 'Heuristic Compose late-joiner report must be passed');

  const fixedSummary = fixedReport.antiEntropy;
  const heuristicSummary = heuristicReport.antiEntropy;
  assert.ok(isAntiEntropySummary(fixedSummary), 'Fixed report must include antiEntropy summary');
  assert.ok(isAntiEntropySummary(heuristicSummary), 'Heuristic report must include antiEntropy summary');

  assert.ok(
    heuristicSummary.producerIdleSkipsTotal > fixedSummary.producerIdleSkipsTotal,
    `Heuristic should idle-skip more on producers (heuristic=${heuristicSummary.producerIdleSkipsTotal}, fixed=${fixedSummary.producerIdleSkipsTotal})`,
  );

  const abComparison: AbComparisonReport = {
    fixedWallMs: fixedReport.scenarioWallMs ?? fixedReport.duration,
    heuristicWallMs: heuristicReport.scenarioWallMs ?? heuristicReport.duration,
    fixed: fixedSummary,
    heuristic: heuristicSummary,
  };

  const report = generateTestReport(
    'compose-dormant-room-ab',
    heuristicReport.totalNodes,
    Math.round((abComparison.fixedWallMs + abComparison.heuristicWallMs) / 1000),
    {
      workerResults: [],
      summary: heuristicReport.summary,
    },
    true,
    {
      antiEntropy: heuristicSummary,
      scenarioWallMs: abComparison.fixedWallMs + abComparison.heuristicWallMs,
      abComparison,
    },
  );

  return { passed: true, abComparison, report };
};

/** Assert wan wall time is within multiplier of lan (default 2×). */
export const assertWanWithinLanMultiplier = (
  lanWallMs: number,
  wanWallMs: number,
  multiplier = Number(process.env.WAN_MAX_LAN_MULTIPLIER ?? '2'),
): void => {
  assert.ok(lanWallMs > 0, 'lanWallMs must be > 0');
  assert.ok(wanWallMs > 0, 'wanWallMs must be > 0');
  assert.ok(multiplier > 0, 'WAN_MAX_LAN_MULTIPLIER must be > 0');
  const limit = lanWallMs * multiplier;
  assert.ok(wanWallMs <= limit, `WAN wall ${wanWallMs}ms exceeds ${multiplier}× LAN ${lanWallMs}ms (limit ${limit}ms)`);
};

const main = async (): Promise<void> => {
  const fixedPath = process.env.COMPOSE_AB_FIXED_REPORT;
  const heuristicPath = process.env.COMPOSE_AB_HEURISTIC_REPORT;
  if (!fixedPath || !heuristicPath) {
    throw new Error('COMPOSE_AB_FIXED_REPORT and COMPOSE_AB_HEURISTIC_REPORT are required');
  }

  const fixedReport = loadComposeTestReport(fixedPath);
  const heuristicReport = loadComposeTestReport(heuristicPath);
  const { report, abComparison } = mergeComposeAbReports({ fixedReport, heuristicReport });

  printTestReport(report);

  const reportsDir = resolve(process.cwd(), 'tests/compose-interop/reports');
  mkdirSync(reportsDir, { recursive: true });
  const out =
    process.env.COMPOSE_REPORT_PATH ??
    resolve(reportsDir, `compose-dormant-room-ab-${report.timestamp.replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  logger.info(
    `[compose-ab] wrote ${out} (heuristic idleSkips=${abComparison.heuristic.producerIdleSkipsTotal} vs fixed=${abComparison.fixed.producerIdleSkipsTotal})`,
  );
};

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
};

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error('dormant-room-ab failed', error);
    process.exit(1);
  });
}
