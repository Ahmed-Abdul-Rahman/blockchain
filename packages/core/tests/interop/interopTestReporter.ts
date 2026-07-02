import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArg } from './helper';
import { AbComparisonReport, AggregatedResult, AntiEntropyInteropSummary, TestReport, WorkerResult } from './types';

export const readInteropCliArgs = () => ({
  totalNodesArg: parseArg<number>('nodes'),
  runDurationSecArg: parseArg<number>('duration'),
  messageRateArg: parseArg<number>('rate'),
  pubsubTopicArg: parseArg<string>('topic'),
  networkIdArg: parseArg<string>('net'),
});

/** Aggregate anti-entropy metrics across late joiner and producer workers */
export const summarizeAntiEntropyMetrics = (
  workerResults: readonly WorkerResult[],
): AntiEntropyInteropSummary | undefined => {
  if (!workerResults.some((r) => r.antiEntropy)) {
    return undefined;
  }

  const lateJoiner = workerResults.find((r) => r.hasTargetData !== undefined);
  const producers = workerResults.filter((r) => r.hasTargetData === undefined && r.antiEntropy);

  return {
    lateJoiner: lateJoiner?.antiEntropy,
    producerIdleSkipsTotal: producers.reduce((sum, r) => sum + (r.antiEntropy?.idleSkips ?? 0), 0),
    producerOutboundAttemptsTotal: producers.reduce((sum, r) => sum + (r.antiEntropy?.outboundAttempts ?? 0), 0),
    producerFloorSyncForcesTotal: producers.reduce((sum, r) => sum + (r.antiEntropy?.floorSyncForces ?? 0), 0),
    producerScheduledTicksTotal: producers.reduce((sum, r) => sum + (r.antiEntropy?.scheduledTicks ?? 0), 0),
  };
};

export type GenerateTestReportOptions = {
  readonly antiEntropy?: AntiEntropyInteropSummary;
  readonly scenarioWallMs?: number;
  readonly abComparison?: AbComparisonReport;
};

export const generateTestReport = (
  testName: string,
  totalNodes: number,
  duration: number,
  aggregatedResults: AggregatedResult,
  passed: boolean,
  options: GenerateTestReportOptions = {},
): TestReport => {
  const antiEntropy = options.antiEntropy ?? summarizeAntiEntropyMetrics(aggregatedResults.workerResults);

  return {
    testName,
    totalNodes,
    duration,
    summary: aggregatedResults.summary,
    passed,
    timestamp: new Date().toISOString(),
    antiEntropy,
    scenarioWallMs: options.scenarioWallMs,
    abComparison: options.abComparison,
  };
};

const printAntiEntropySection = (antiEntropy: AntiEntropyInteropSummary): void => {
  console.log('\n--- Anti-Entropy Metrics ---');
  if (antiEntropy.lateJoiner) {
    console.log(`  Late joiner usefulSyncs: ${antiEntropy.lateJoiner.usefulSyncs}`);
    console.log(`  Late joiner convergenceMs: ${antiEntropy.lateJoiner.convergenceMs ?? 'n/a'}`);
    console.log(`  Late joiner idleSkips: ${antiEntropy.lateJoiner.idleSkips ?? 0}`);
    console.log(`  Late joiner floorSyncForces: ${antiEntropy.lateJoiner.floorSyncForces ?? 0}`);
    console.log(`  Late joiner scheduledTicks: ${antiEntropy.lateJoiner.scheduledTicks ?? 0}`);
  }
  console.log(`  Producer idleSkips (total): ${antiEntropy.producerIdleSkipsTotal}`);
  console.log(`  Producer outboundAttempts (total): ${antiEntropy.producerOutboundAttemptsTotal}`);
  console.log(`  Producer floorSyncForces (total): ${antiEntropy.producerFloorSyncForcesTotal}`);
  console.log(`  Producer scheduledTicks (total): ${antiEntropy.producerScheduledTicksTotal}`);
};

export const printTestReport = (report: TestReport): void => {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST REPORT: ${report.testName}`);
  console.log('='.repeat(80));
  console.log(`Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Nodes: ${report.totalNodes}`);
  console.log(`Duration: ${report.duration}s`);
  if (report.scenarioWallMs !== undefined) {
    console.log(`Scenario wall time: ${(report.scenarioWallMs / 1000).toFixed(1)}s`);
  }
  console.log(`Timestamp: ${report.timestamp}`);
  console.log('\n--- Connection Metrics ---');
  console.log(`  P50: ${report.summary.connections.p50.toFixed(2)}`);
  console.log(`  P95: ${report.summary.connections.p95.toFixed(2)}`);
  console.log(`  Avg: ${report.summary.connections.avg.toFixed(2)}`);
  console.log('\n--- Verified Peers ---');
  console.log(`  P50: ${report.summary.verified.p50.toFixed(2)}`);
  console.log(`  P95: ${report.summary.verified.p95.toFixed(2)}`);
  console.log(`  Avg: ${report.summary.verified.avg.toFixed(2)}`);
  console.log('\n--- Time to First Verified Peer (ms) ---');
  console.log(`  P50: ${report.summary.ttfVerifiedMs.p50.toFixed(2)}`);
  console.log(`  P95: ${report.summary.ttfVerifiedMs.p95.toFixed(2)}`);
  console.log(`  Avg: ${report.summary.ttfVerifiedMs.avg.toFixed(2)}`);

  if (report.antiEntropy) {
    printAntiEntropySection(report.antiEntropy);
  }

  if (report.abComparison) {
    const { fixed, heuristic, fixedWallMs, heuristicWallMs } = report.abComparison;
    console.log('\n--- A/B Comparison (fixed vs heuristic) ---');
    console.log(`  Fixed wallMs: ${fixedWallMs}`);
    console.log(`  Heuristic wallMs: ${heuristicWallMs}`);
    console.log(
      `  Heuristic producer idleSkips: ${heuristic.producerIdleSkipsTotal} vs Fixed: ${fixed.producerIdleSkipsTotal}`,
    );
    console.log(
      `  Heuristic producer outboundAttempts: ${heuristic.producerOutboundAttemptsTotal} vs Fixed: ${fixed.producerOutboundAttemptsTotal}`,
    );
    if (heuristic.lateJoiner?.convergenceMs !== undefined && fixed.lateJoiner?.convergenceMs !== undefined) {
      console.log(
        `  Heuristic lateJoiner convergenceMs: ${heuristic.lateJoiner.convergenceMs} vs Fixed: ${fixed.lateJoiner.convergenceMs}`,
      );
    }
  }

  console.log('='.repeat(80) + '\n');

  if (process.env.INTEROP_WRITE_REPORT_JSON === 'true') {
    writeInteropReportJson(report);
  }
};

/** Write report JSON for nightly artifact collection */
export const writeInteropReportJson = (report: TestReport): void => {
  const reportsDir = resolve(process.cwd(), 'tests/interop/reports');
  mkdirSync(reportsDir, { recursive: true });
  const safeName = report.testName.replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase();
  const filePath = resolve(reportsDir, `${safeName}-${report.timestamp.replace(/[:.]/g, '-')}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2));
  console.log(`[Interop] Report written to ${filePath}`);
};

export const assertStartupWorkerResults = (workerResults: WorkerResult[], totalNodes: number): boolean => {
  let passed = true;

  workerResults.forEach((workerResult, index) => {
    const verifiedOk = workerResult.verified >= totalNodes / 2;
    const connectionsOk = workerResult.connections > totalNodes / 3;

    if (!verifiedOk || !connectionsOk) {
      passed = false;
      console.log(`⚠️  Node ${index} below threshold:`);
      console.log(`   Verified: ${workerResult.verified} (min: ${totalNodes / 2})`);
      console.log(`   Connections: ${workerResult.connections} (min: ${totalNodes / 3})`);
    }

    assert.ok(verifiedOk, `Node ${index} verified peers below threshold`);
    assert.ok(connectionsOk, `Node ${index} connections below threshold`);
  });

  return passed;
};

export type AssertLateJoinerConvergenceOptions = {
  /** When false, allows convergence via gossip/passive replication (A/B idle-skip runs) */
  readonly requireUsefulSync?: boolean;
};

/** Shared assertions for late-joiner anti-entropy convergence scenarios */
export const assertLateJoinerConvergence = (
  workerResults: readonly WorkerResult[],
  options: AssertLateJoinerConvergenceOptions = {},
): boolean => {
  const requireUsefulSync = options.requireUsefulSync ?? true;
  const lateJoiner = workerResults.find((r) => r.hasTargetData !== undefined);
  const producers = workerResults.filter((r) => r.hasTargetData === undefined);
  const maxProducerReplicaCount = Math.max(0, ...producers.map((r) => r.replicaCount ?? 0));

  let passed = true;

  if (!lateJoiner?.hasTargetData) {
    passed = false;
    console.log(
      `⚠️ Late joiner failed to converge. replicaCount: ${lateJoiner?.replicaCount}, ` +
        `antiEntropy: ${JSON.stringify(lateJoiner?.antiEntropy)}`,
    );
  }

  if (lateJoiner && (lateJoiner.replicaCount ?? 0) < maxProducerReplicaCount) {
    passed = false;
    console.log(`⚠️ Late joiner store incomplete: ${lateJoiner.replicaCount} < producer max ${maxProducerReplicaCount}`);
  }

  if (requireUsefulSync && (lateJoiner?.antiEntropy?.usefulSyncs ?? 0) <= 0) {
    passed = false;
    console.log('⚠️ Late joiner reported no useful anti-entropy syncs');
  }

  assert.ok(lateJoiner?.hasTargetData, 'Late joiner failed to converge missing hashes via anti-entropy');
  assert.ok(
    (lateJoiner?.replicaCount ?? 0) >= maxProducerReplicaCount,
    `Late joiner store (${lateJoiner?.replicaCount}) did not reach producer size (${maxProducerReplicaCount})`,
  );
  if (requireUsefulSync) {
    assert.ok((lateJoiner?.antiEntropy?.usefulSyncs ?? 0) > 0, 'Late joiner should report at least one useful sync');
  }

  return passed;
};
