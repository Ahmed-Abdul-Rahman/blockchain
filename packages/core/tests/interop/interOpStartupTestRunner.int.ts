import { describe, it } from 'node:test';
import { parseArg } from './helper';
import { simulateBurstPeersAtStartUp, simulatePeerChurn, simulateStaggeredPeersAtStartUp } from './InterOpScenarios';
import { assertStartupHealth, evaluateStartupHealth } from './interopStartupAssertions';
import { generateTestReport, printTestReport } from './interopTestReporting';

const totalNodesArg: number = parseArg('nodes');
const runDurationSecArg: number = parseArg('duration');
const messageRateArg: number = parseArg('rate');
const pubsubTopicArg: string = parseArg('topic');
const networkIdArg: string = parseArg('net');

describe('Interop - Network Startup Tests', () => {
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

    const evaluation = evaluateStartupHealth(aggregatedResults, totalNodes, 'standard');
    assertStartupHealth(aggregatedResults, totalNodes, 'standard');

    const report = generateTestReport(
      'Burst Startup',
      totalNodes,
      runDurationSec,
      aggregatedResults,
      evaluation.passed,
    );
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

    const evaluation = evaluateStartupHealth(aggregatedResults, totalNodes, 'standard');
    assertStartupHealth(aggregatedResults, totalNodes, 'standard');

    const report = generateTestReport(
      'Staggered Startup',
      totalNodes,
      runDurationSec,
      aggregatedResults,
      evaluation.passed,
    );
    printTestReport(report);
  });
});

describe('Interop - Network Stability Tests', () => {
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

    const evaluation = evaluateStartupHealth(aggregatedResults, totalNodes, 'churn');
    assertStartupHealth(aggregatedResults, totalNodes, 'churn');

    const report = generateTestReport('Peer Churn', totalNodes, runDurationSec, aggregatedResults, evaluation.passed);
    printTestReport(report);
  });
});
