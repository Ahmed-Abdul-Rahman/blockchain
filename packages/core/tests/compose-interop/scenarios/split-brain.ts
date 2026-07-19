/**
 * Compose split-brain: two partitioned cohorts produce independently, then heal and
 * converge the hash union via anti-entropy (port of simulateSplitBrainConvergence).
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '@dechat/common';
import { generateTestReport, printTestReport, summarizeAntiEntropyMetrics } from '../../interop/interopTestReporter';
import {
  computeLateJoinerPollTimeoutMs,
  computeMeshStabilizeMs,
  computeReplicateSettleMs,
} from '../../interop/interopTiming';
import type { AggregatedResult, WorkerResult } from '../../interop/types';
import { type ComposeOrchestrator, createComposeOrchestrator } from '../composeOrchestrator';
import { partitionsDiverged, splitPartitionIndices } from './splitBrainPartitions';

const execFileAsync = promisify(execFile);
const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Host path — scripts stay in the source tree (not emitted to dist/). cwd is packages/core. */
const applyPartitionScript = (): string =>
  process.env.COMPOSE_PARTITION_SCRIPT && process.env.COMPOSE_PARTITION_SCRIPT.length > 0
    ? process.env.COMPOSE_PARTITION_SCRIPT
    : resolve(process.cwd(), 'tests/compose-interop/scripts/apply-partition.sh');

const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return -1;
  const i = Math.floor((p / 100) * (xs.length - 1));
  return xs[i];
};

const average = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const aggregate = (results: WorkerResult[]): AggregatedResult => {
  const connections = results.map((r) => r.connections);
  const verified = results.map((r) => r.verified);
  const ttfvp = results.map((r) => r.ttfvpMs).filter((x) => x >= 0);
  return {
    workerResults: results,
    summary: {
      nodes: results.length,
      connections: { p50: percentile(connections, 50), p95: percentile(connections, 95), avg: average(connections) },
      verified: { p50: percentile(verified, 50), p95: percentile(verified, 95), avg: average(verified) },
      ttfVerifiedMs: { p50: percentile(ttfvp, 50), p95: percentile(ttfvp, 95), avg: average(ttfvp) },
    },
  };
};

const runPartitionAction = async (action: 'partition' | 'heal', totalNodes: number): Promise<void> => {
  logger.info(`[compose-split-brain] iptables ${action}`);
  await execFileAsync('bash', [applyPartitionScript(), action], {
    env: { ...process.env, COMPOSE_NODES: String(totalNodes) },
  });
};

type AddrReport = { index: number; addrs: string[] };

const collectAddrReports = async (orch: ComposeOrchestrator, indices: readonly number[]): Promise<AddrReport[]> =>
  Promise.all(
    indices.map(async (index) => {
      const cached = await orch.getAddrs(index);
      if (cached.length > 0) return { index, addrs: cached };
      const report = await orch.requestListenAddrs(index, 15_000);
      return { index, addrs: report.addrs };
    }),
  );

const meshCohort = async (
  orch: ComposeOrchestrator,
  cohort: readonly number[],
  addrReports: readonly AddrReport[],
): Promise<void> => {
  const cohortAddrs = Array.from(new Set(addrReports.filter((r) => cohort.includes(r.index)).flatMap((r) => r.addrs)));
  for (const index of cohort) {
    const selfAddrs = addrReports.find((r) => r.index === index)?.addrs ?? [];
    const peers = cohortAddrs.filter((addr) => !selfAddrs.includes(addr));
    await orch.send(index, { type: 'connect_peers', multiaddrs: peers.length > 0 ? peers : cohortAddrs });
    await orch.waitEvent(index, 'connect_peers_done', 60_000);
  }
};

const meshAll = async (
  orch: ComposeOrchestrator,
  indices: readonly number[],
  addrReports: readonly AddrReport[],
): Promise<void> => {
  const allAddrs = Array.from(new Set(addrReports.flatMap((r) => r.addrs)));
  for (const index of indices) {
    const selfAddrs = addrReports.find((r) => r.index === index)?.addrs ?? [];
    const peers = allAddrs.filter((addr) => !selfAddrs.includes(addr));
    await orch.send(index, { type: 'connect_peers', multiaddrs: peers.length > 0 ? peers : allAddrs });
    await orch.waitEvent(index, 'connect_peers_done', 90_000);
  }
};

const main = async (): Promise<void> => {
  const totalNodes = Number(process.env.COMPOSE_NODES ?? '6');
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS ?? '15000');
  const healConnectMs = Number(process.env.COMPOSE_HEAL_CONNECT_MS ?? '45000');
  const startedAt = Date.now();

  const { partitionA, partitionB, half } = splitPartitionIndices(totalNodes);
  const allIndices = [...partitionA, ...partitionB];
  const orch = await createComposeOrchestrator(redisUrl);

  try {
    logger.info(
      `[compose-split-brain] waiting for ${totalNodes} nodes (A=0..${half - 1} B=${half}..${totalNodes - 1})`,
    );
    await orch.waitReady(allIndices, 120_000);

    const addrReports = await collectAddrReports(orch, allIndices);

    // Isolate A↔B before any mesh forms.
    await runPartitionAction('partition', totalNodes);

    await meshCohort(orch, partitionA, addrReports);
    await meshCohort(orch, partitionB, addrReports);

    const stabilizeMs = computeMeshStabilizeMs(half);
    logger.info(`[compose-split-brain] partition mesh stabilize ${stabilizeMs}ms`);
    await sleep(stabilizeMs);

    for (const index of partitionA) {
      await orch.send(index, { type: 'produce_messages_replication' });
    }
    const settleA = computeReplicateSettleMs(half);
    logger.info(`[compose-split-brain] side A replicate settle ${settleA}ms`);
    await sleep(settleA);
    const sideAHashes = Array.from(
      new Set((await Promise.all(partitionA.map((i) => orch.requestHashes(i, 15_000)))).flat()),
    );
    logger.info(`[compose-split-brain] side A hashes=${sideAHashes.length}`);

    for (const index of partitionB) {
      await orch.send(index, { type: 'produce_messages_replication' });
    }
    const settleB = computeReplicateSettleMs(half);
    logger.info(`[compose-split-brain] side B replicate settle ${settleB}ms`);
    await sleep(settleB);
    const sideBHashes = Array.from(
      new Set((await Promise.all(partitionB.map((i) => orch.requestHashes(i, 15_000)))).flat()),
    );
    logger.info(`[compose-split-brain] side B hashes=${sideBHashes.length}`);

    if (!partitionsDiverged(sideAHashes, sideBHashes)) {
      throw new Error('Partitions did not diverge before heal (expected disjoint produced hashes)');
    }

    const expectedUnion = Array.from(new Set([...sideAHashes, ...sideBHashes]));
    logger.info(`[compose-split-brain] expected union=${expectedUnion.length}`);

    await runPartitionAction('heal', totalNodes);

    // Fresh addrs after heal (IPs unchanged; refresh for safety).
    const healedAddrs = await collectAddrReports(orch, allIndices);
    await meshAll(orch, allIndices, healedAddrs);
    logger.info(`[compose-split-brain] heal connect settle ${healConnectMs}ms`);
    await sleep(healConnectMs);
    await meshAll(orch, allIndices, healedAddrs);
    await sleep(healConnectMs);

    for (const index of allIndices) {
      await orch.send(index, { type: 'set_expected_hashes', hashes: expectedUnion });
    }

    const pollTimeout = computeLateJoinerPollTimeoutMs(totalNodes, syncIntervalMs);
    const pollDeadline = Date.now() + pollTimeout;
    let converged = false;
    while (Date.now() < pollDeadline) {
      const stats = await Promise.all(allIndices.map((i) => orch.requestStatistics(i, 15_000)));
      const ok = stats.every((s) => s.hasTargetData === true);
      const counts = stats.map((s) => s.replicaCount ?? 0);
      logger.info(
        `[compose-split-brain] converge hasTarget=${stats.filter((s) => s.hasTargetData).length}/${totalNodes} replicas=[${counts.join(',')}]`,
      );
      if (ok) {
        converged = true;
        break;
      }
      await sleep(3_000);
    }

    if (!converged) {
      throw new Error(`Split-brain union failed to converge within ${pollTimeout}ms`);
    }

    // Verify full union on every node (not just hasTargetData flag).
    const finalHashes = await Promise.all(allIndices.map((i) => orch.requestHashes(i, 15_000)));
    for (let i = 0; i < allIndices.length; i++) {
      const local = new Set(finalHashes[i]);
      const missing = expectedUnion.filter((h) => !local.has(h)).length;
      if (missing > 0) {
        throw new Error(`Node ${allIndices[i]} missing ${missing}/${expectedUnion.length} union hashes after heal`);
      }
    }

    const allStats = await Promise.all(allIndices.map((i) => orch.requestStatistics(i, 15_000)));
    for (const index of allIndices) {
      await orch.send(index, { type: 'terminate' });
    }
    await sleep(3_000);

    const wallMs = Date.now() - startedAt;
    const report = generateTestReport(
      'compose-split-brain',
      totalNodes,
      Math.round(wallMs / 1000),
      aggregate(allStats),
      true,
      {
        antiEntropy: summarizeAntiEntropyMetrics(allStats),
        scenarioWallMs: wallMs,
      },
    );
    printTestReport(report);

    const reportsDir = resolve(process.cwd(), 'tests/compose-interop/reports');
    mkdirSync(reportsDir, { recursive: true });
    const out =
      process.env.COMPOSE_REPORT_PATH && process.env.COMPOSE_REPORT_PATH.length > 0
        ? process.env.COMPOSE_REPORT_PATH
        : resolve(reportsDir, `compose-split-brain-${report.timestamp.replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, JSON.stringify(report, null, 2));
    logger.info(`[compose-split-brain] wrote ${out} wallMs=${wallMs}`);
  } finally {
    // Best-effort heal so teardown is not left with DROP rules if assert failed mid-partition.
    try {
      await runPartitionAction('heal', totalNodes);
    } catch {
      // containers may already be gone
    }
    await orch.close();
  }
};

main().catch((error: unknown) => {
  console.error('split-brain orchestrator failed', error);
  process.exit(1);
});
