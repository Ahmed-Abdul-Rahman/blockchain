import { describe, it } from 'node:test';
import { simulateAntiEntropyConvergence } from './InterOpScenarios';
import {
  assertLateJoinerConvergence,
  generateTestReport,
  printTestReport,
  readInteropCliArgs,
  summarizeAntiEntropyMetrics,
} from './interopTestReporter';

const { totalNodesArg, runDurationSecArg, messageRateArg, pubsubTopicArg, networkIdArg } = readInteropCliArgs();

describe('Interop - Adaptive Anti-Entropy Scale', () => {
  it('should converge a late-joining peer with adaptive heuristic scheduler at scale', async () => {
    const totalNodes = totalNodesArg ?? 6;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-scale';
    const syncIntervalMs = 15_000;

    const scenarioStartedAt = Date.now();
    const aggregatedResults = await simulateAntiEntropyConvergence({
      testType: 'REPLICATION',
      replicationType: 'TOPIC_BASED',
      dataSyncEnabled: true,
      syncIntervalMs,
      adaptive: {
        enabled: true,
        scheduler: 'heuristic',
        minIntervalMs: 5_000,
        maxIntervalMs: 60_000,
      },
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs: [],
    });
    const scenarioWallMs = Date.now() - scenarioStartedAt;

    const { workerResults } = aggregatedResults;
    const passed = assertLateJoinerConvergence(workerResults);

    const report = generateTestReport(
      `Anti-Entropy Adaptive Scale (${totalNodes} nodes)`,
      totalNodes,
      runDurationSec,
      aggregatedResults,
      passed,
      {
        antiEntropy: summarizeAntiEntropyMetrics(workerResults),
        scenarioWallMs,
      },
    );
    printTestReport(report);
  });
});
