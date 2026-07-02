import assert from 'node:assert';
import { describe, it } from 'node:test';
import { simulateAntiEntropyConvergenceAbComparison } from './InterOpScenarios';
import {
  assertLateJoinerConvergence,
  generateTestReport,
  printTestReport,
  readInteropCliArgs,
  summarizeAntiEntropyMetrics,
} from './interopTestReporter';

const { totalNodesArg, runDurationSecArg, messageRateArg, pubsubTopicArg, networkIdArg } = readInteropCliArgs();

const runAbTest = process.env.INTEROP_AB_TEST === 'true';

describe('Interop - Adaptive Anti-Entropy A/B', () => {
  it('should A/B compare fixed vs heuristic late-joiner convergence', { skip: !runAbTest }, async () => {
    const totalNodes = totalNodesArg ?? 6;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-ab';
    const syncIntervalMs = 15_000;

    const comparison = await simulateAntiEntropyConvergenceAbComparison({
      testType: 'REPLICATION',
      replicationType: 'TOPIC_BASED',
      dataSyncEnabled: true,
      syncIntervalMs,
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs: [],
    });

    const fixedPassed = assertLateJoinerConvergence(comparison.fixed.result.workerResults, {
      requireUsefulSync: false,
    });
    const heuristicPassed = assertLateJoinerConvergence(comparison.heuristic.result.workerResults, {
      requireUsefulSync: false,
    });

    const fixedSummary = summarizeAntiEntropyMetrics(comparison.fixed.result.workerResults);
    const heuristicSummary = summarizeAntiEntropyMetrics(comparison.heuristic.result.workerResults);

    assert.ok(fixedSummary, 'Fixed run should export anti-entropy metrics');
    assert.ok(heuristicSummary, 'Heuristic run should export anti-entropy metrics');

    assert.ok(
      heuristicSummary.producerIdleSkipsTotal > fixedSummary.producerIdleSkipsTotal,
      `Heuristic should idle-skip more on producers (heuristic=${heuristicSummary.producerIdleSkipsTotal}, fixed=${fixedSummary.producerIdleSkipsTotal})`,
    );

    const passed = fixedPassed && heuristicPassed;

    const report = generateTestReport(
      'Anti-Entropy Fixed vs Heuristic A/B',
      totalNodes,
      runDurationSec,
      comparison.heuristic.result,
      passed,
      {
        antiEntropy: heuristicSummary,
        abComparison: {
          fixedWallMs: comparison.fixed.wallMs,
          heuristicWallMs: comparison.heuristic.wallMs,
          fixed: fixedSummary,
          heuristic: heuristicSummary,
        },
      },
    );
    printTestReport(report);
  });
});
