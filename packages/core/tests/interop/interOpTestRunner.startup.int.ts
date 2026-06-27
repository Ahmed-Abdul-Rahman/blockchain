import { describe, it } from 'node:test';
import { simulateBurstPeersAtStartUp, simulatePeerChurn, simulateStaggeredPeersAtStartUp } from './InterOpScenarios';
import {
  assertStartupWorkerResults,
  generateTestReport,
  printTestReport,
  readInteropCliArgs,
} from './interopTestReporter';

const { totalNodesArg, runDurationSecArg, messageRateArg, pubsubTopicArg, networkIdArg } = readInteropCliArgs();

describe('P2P Network Integration StartUp Tests', () => {
  it(`Burst startup of ${totalNodesArg ?? 12} nodes at once`, async () => {
    const totalNodes = totalNodesArg ?? 12;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulateBurstPeersAtStartUp({
      testType: 'STARTUP',
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
      dataSyncEnabled: false,
    });

    const passed = assertStartupWorkerResults(aggregatedResults.workerResults, totalNodes);
    const report = generateTestReport('Burst Startup', totalNodes, runDurationSec, aggregatedResults, passed);
    printTestReport(report);
  });

  it(`Staggered startup of ${totalNodesArg ?? 10} nodes`, async () => {
    const totalNodes = totalNodesArg ?? 10;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulateStaggeredPeersAtStartUp({
      testType: 'STARTUP',
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
      dataSyncEnabled: false,
    });

    const passed = assertStartupWorkerResults(aggregatedResults.workerResults, totalNodes);
    const report = generateTestReport('Staggered Startup', totalNodes, runDurationSec, aggregatedResults, passed);
    printTestReport(report);
  });
});

describe('P2P Network Integration Stability Tests', () => {
  it(`Peer Churn - Random peers drop and rejoin`, async () => {
    const totalNodes = totalNodesArg ?? 10;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulatePeerChurn({
      testType: 'STARTUP',
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
      dataSyncEnabled: false,
    });

    const passed = assertStartupWorkerResults(aggregatedResults.workerResults, totalNodes);
    const report = generateTestReport('Peer Churn', totalNodes, runDurationSec, aggregatedResults, passed);
    printTestReport(report);
  });
});
