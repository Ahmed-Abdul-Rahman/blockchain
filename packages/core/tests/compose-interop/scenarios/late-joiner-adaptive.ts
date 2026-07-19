import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '@dechat/common';
import { generateTestReport, printTestReport, summarizeAntiEntropyMetrics } from '../../interop/interopTestReporter';
import {
  computeLateJoinerPollTimeoutMs,
  computeMeshStabilizeMs,
  computeProducerConsensusTimeoutMs,
  computeReplicateSettleMs,
} from '../../interop/interopTiming';
import type { AggregatedResult, WorkerResult } from '../../interop/types';
import { createComposeOrchestrator } from '../composeOrchestrator';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const main = async (): Promise<void> => {
  const totalNodes = Number(process.env.COMPOSE_NODES ?? '7');
  const producerCount = totalNodes - 1;
  const lateJoinerIndex = totalNodes - 1;
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS ?? '15000');
  const startedAt = Date.now();

  const producers = Array.from({ length: producerCount }, (_, i) => i);
  const orch = await createComposeOrchestrator(redisUrl);

  try {
    logger.info(`[compose-orch] waiting for ${producerCount} producers + late joiner ready`);
    await orch.waitReady([...producers, lateJoinerIndex], 120_000);

    // Explicit mesh: each producer dials every other producer.
    const addrReports = await Promise.all(
      producers.map(async (index) => {
        const cached = await orch.getAddrs(index);
        if (cached.length > 0) return { index, addrs: cached };
        return { index, ...(await orch.requestListenAddrs(index, 15_000)) };
      }),
    );
    const allProducerAddrs = Array.from(new Set(addrReports.flatMap((r) => r.addrs)));

    for (const index of producers) {
      const peers = allProducerAddrs.filter(
        (addr) => !addrReports.find((r) => r.index === index)?.addrs.includes(addr),
      );
      await orch.send(index, { type: 'connect_peers', multiaddrs: peers.length > 0 ? peers : allProducerAddrs });
      await orch.waitEvent(index, 'connect_peers_done', 60_000);
    }

    const stabilizeMs = computeMeshStabilizeMs(totalNodes);
    logger.info(`[compose-orch] mesh stabilize ${stabilizeMs}ms`);
    await sleep(stabilizeMs);

    for (const index of producers) {
      await orch.send(index, { type: 'produce_messages_replication' });
    }

    const settleMs = computeReplicateSettleMs(totalNodes);
    logger.info(`[compose-orch] replicate settle ${settleMs}ms`);
    await sleep(settleMs);

    const consensusDeadline = Date.now() + computeProducerConsensusTimeoutMs(totalNodes);
    let consensus = false;
    while (Date.now() < consensusDeadline) {
      const stats = await Promise.all(producers.map((i) => orch.requestStatistics(i, 15_000)));
      const counts = stats.map((s) => s.replicaCount ?? 0);
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      logger.info(`[compose-orch] producer replicas min=${min} max=${max}`);
      if (min > 0 && min === max) {
        consensus = true;
        break;
      }
      await sleep(5_000);
    }
    if (!consensus) {
      throw new Error('Producer replica consensus timeout');
    }

    const hashSets = await Promise.all(producers.map((i) => orch.requestHashes(i, 15_000)));
    const expectedHashes = Array.from(new Set(hashSets.flat()));
    logger.info(`[compose-orch] expectedHashes=${expectedHashes.length}`);
    logger.info(`[compose-orch] producer addrs sample=${allProducerAddrs.slice(0, 3).join(',')}`);

    // Equal replica counts alone can mean "each node only has local data" (no mesh).
    for (let i = 0; i < producers.length; i++) {
      const local = new Set(hashSets[i]);
      const missing = expectedHashes.filter((h) => !local.has(h)).length;
      if (missing > 0) {
        throw new Error(
          `Producer ${producers[i]} missing ${missing}/${expectedHashes.length} hashes after mesh — dial/advertise broken`,
        );
      }
    }

    await orch.send(lateJoinerIndex, { type: 'set_expected_hashes', hashes: expectedHashes });
    await orch.send(lateJoinerIndex, { type: 'connect_peers', multiaddrs: allProducerAddrs });
    await orch.waitEvent(lateJoinerIndex, 'connect_peers_done', 60_000);
    await sleep(20_000);

    const pollTimeout = computeLateJoinerPollTimeoutMs(totalNodes, syncIntervalMs);
    const pollDeadline = Date.now() + pollTimeout;
    let lateStats: WorkerResult | undefined;
    while (Date.now() < pollDeadline) {
      lateStats = await orch.requestStatistics(lateJoinerIndex, 15_000);
      logger.info(
        `[compose-orch] late joiner hasTargetData=${String(lateStats.hasTargetData)} usefulSyncs=${lateStats.antiEntropy?.usefulSyncs ?? 0}`,
      );
      if (lateStats.hasTargetData === true) break;
      await sleep(2_000);
    }

    if (lateStats?.hasTargetData !== true) {
      throw new Error(`Late joiner failed to converge within ${pollTimeout}ms`);
    }

    // Let dormant producers tick so heuristic idle-skips are observable (A/B).
    const dormantSettleMs = Number(process.env.COMPOSE_DORMANT_SETTLE_MS ?? String(syncIntervalMs * 2));
    if (dormantSettleMs > 0) {
      logger.info(`[compose-orch] dormant settle ${dormantSettleMs}ms (idle-skip telemetry)`);
      await sleep(dormantSettleMs);
    }

    const producerStats = await Promise.all(producers.map((i) => orch.requestStatistics(i, 15_000)));
    // Refresh late-joiner stats after settle so the report matches producer snapshot time.
    lateStats = await orch.requestStatistics(lateJoinerIndex, 15_000);
    const allStats = [...producerStats, lateStats];

    for (const index of [...producers, lateJoinerIndex]) {
      await orch.send(index, { type: 'terminate' });
    }
    await sleep(3_000);

    const aggregated = aggregate(allStats);
    const passed = true;
    const report = generateTestReport(
      'compose-late-joiner-adaptive',
      totalNodes,
      Date.now() - startedAt,
      aggregated,
      passed,
      {
        antiEntropy: summarizeAntiEntropyMetrics(allStats),
        scenarioWallMs: Date.now() - startedAt,
      },
    );
    printTestReport(report);

    const reportsDir = resolve(process.cwd(), 'tests/compose-interop/reports');
    mkdirSync(reportsDir, { recursive: true });
    const out =
      process.env.COMPOSE_REPORT_PATH && process.env.COMPOSE_REPORT_PATH.length > 0
        ? process.env.COMPOSE_REPORT_PATH
        : resolve(reportsDir, `compose-late-joiner-adaptive-${report.timestamp.replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, JSON.stringify(report, null, 2));
    logger.info(
      `[compose-orch] wrote ${out} (scheduler=${process.env.SCHEDULER ?? 'n/a'} adaptive=${process.env.ADAPTIVE_ENABLED ?? 'n/a'} netem=${process.env.NETEM_PROFILE ?? 'lan'} wallMs=${report.scenarioWallMs ?? -1})`,
    );
  } finally {
    await orch.close();
  }
};

main().catch((error: unknown) => {
  console.error('late-joiner-adaptive orchestrator failed', error);
  process.exit(1);
});
