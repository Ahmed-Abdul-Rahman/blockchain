import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseArg } from './helper';
import { simulateBurstPeersAtStartUp, simulatePeerChurn, simulateStaggeredPeersAtStartUp } from './InterOpScenarios';
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

    const { workerResults } = aggregatedResults;
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

    const { workerResults } = aggregatedResults;
    let passed = true;

    workerResults.forEach((workerResult, index) => {
      const verifiedOk = workerResult.verified >= totalNodes / 2;
      const connectionsOk = workerResult.connections > totalNodes / 3;

      if (!verifiedOk || !connectionsOk) {
        passed = false;
      }

      assert.ok(verifiedOk);
      assert.ok(connectionsOk);
    });

    const report = generateTestReport('Staggered Startup', totalNodes, runDurationSec, aggregatedResults, passed);
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

    const { workerResults } = aggregatedResults;
    let passed = true;

    workerResults.forEach((workerResult, index) => {
      const verifiedOk = workerResult.verified >= totalNodes / 2;
      const connectionsOk = workerResult.connections > totalNodes / 3;

      if (!verifiedOk || !connectionsOk) {
        passed = false;
      }

      assert.ok(verifiedOk);
      assert.ok(connectionsOk);
    });

    const report = generateTestReport('Peer Churn', totalNodes, runDurationSec, aggregatedResults, passed);
    printTestReport(report);
  });
});
