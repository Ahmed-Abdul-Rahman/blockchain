import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mapValues } from 'es-toolkit';
import { isArray } from 'es-toolkit/compat';
import { parseArg } from './helper';
import {
  simulateBurstPeersAtStartUp,
  simulateBurstPeersAtStartUpWithDataPropagation,
  simulateBurstPeersAtStartUpWithPropagationAndReplication,
  simulatePeerChurn,
  simulateStaggeredPeersAtStartUp,
} from './InterOpScenarios';
import { AggregatedResult, TestReport } from './types';

const totalNodesArg: number = parseArg('nodes');
const runDurationSecArg: number = parseArg('duration');
const messageRateArg: number = parseArg('rate');
const pubsubTopicArg: string = parseArg('topic');
const networkIdArg: string = parseArg('net');

const generateTestReport = (
  testName: string,
  totalNodes: number,
  duration: number,
  aggregatedResults: AggregatedResult,
  passed: boolean,
): TestReport => {
  return {
    testName,
    totalNodes,
    duration,
    summary: aggregatedResults.summary,
    passed,
    timestamp: new Date().toISOString(),
  };
};

const printTestReport = (report: TestReport): void => {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST REPORT: ${report.testName}`);
  console.log('='.repeat(80));
  console.log(`Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Nodes: ${report.totalNodes}`);
  console.log(`Duration: ${report.duration}s`);
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
  console.log('='.repeat(80) + '\n');
};

describe('P2P Network Integration StartUp Tests', () => {
  it(`Burst startup of ${totalNodesArg ?? 12} nodes at once`, async () => {
    const totalNodes = totalNodesArg ?? 12;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulateBurstPeersAtStartUp({
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
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
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
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

describe('P2P Network Integration Stability Tests', () => {
  it(`Peer Churn - Random peers drop and rejoin`, async () => {
    const totalNodes = totalNodesArg ?? 10;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulatePeerChurn({
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
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

describe('Interop - Data Propagation Tests', () => {
  it(`should propagate messages to all peers without duplicates and send direct stream messages`, async () => {
    const totalNodes = totalNodesArg ?? 12;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulateBurstPeersAtStartUpWithDataPropagation({
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
    });

    const { workerResults } = aggregatedResults;
    let passed = true;

    workerResults.forEach((workerResult, index) => {
      const seenMessagesOk = workerResult.seenMessages?.reduce(
        (prevSeen, { topic, seen }) =>
          topic === '/deChat/v1/topic/replication-protocol' ? seen === 72 && prevSeen : seen === 22 && prevSeen,
        true,
      );
      if (!seenMessagesOk) {
        passed = false;
        console.log(`⚠️  Node ${index} has ${workerResult.seenMessages} expected: 22`);
      }
      if (workerResult.directStreamMsgsReceivedCount)
        assert.ok(
          workerResult.directStreamMsgsReceivedCount >= 2 * (totalNodes - 1),
          `Node ${index} has unexpected number of direct messages, expected: ${2 * (totalNodes - 1)}`,
        );
      assert.ok(seenMessagesOk, `Node ${index} has unexpected number of seenMessages , expected: 22`);
    });

    const report = generateTestReport(
      'GossipSub Data and Direct Stream Data Propagation',
      totalNodes,
      runDurationSec,
      aggregatedResults,
      passed,
    );
    printTestReport(report);
  });
});

describe('Interop - Data Replication Tests', () => {
  it(`should replicate all the messages generated by self peer and received by other peers without duplicates`, async () => {
    const totalNodes = totalNodesArg ?? 12;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulateBurstPeersAtStartUpWithPropagationAndReplication({
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
    });

    const { workerResults } = aggregatedResults;
    let passed = true;

    workerResults.forEach((workerResult, index) => {
      const seenMessagesOk = workerResult.seenMessages?.reduce(
        (prevSeen, { topic, seen }) =>
          topic === '/deChat/v1/topic/replication-protocol' ? seen === 72 && prevSeen : seen === 22 && prevSeen,
        true,
      );
      if (!seenMessagesOk) {
        passed = false;
        console.log(`⚠️  Node ${index} has ${workerResult.seenMessages} seenMessages expected: 22`);
      }
      if (workerResult.directStreamMsgsReceivedCount) {
        assert.ok(
          workerResult.directStreamMsgsReceivedCount >= 2 * (totalNodes - 1),
          `Node ${index} has unexpected number of direct messages, expected: ${2 * (totalNodes - 1)}`,
        );
      }
      if (workerResult.replicaCount) {
        // Assert that selective K-replication is active. The node should store SOME data,
        // but no longer stores ALL data on the network.
        assert.ok(
          workerResult.replicaCount > 0 && workerResult.replicaCount < 6 * totalNodes,
          `Node ${index} failed K-replication bounds. Replicas: ${workerResult.replicaCount}`,
        );
      }
    });

    const report = generateTestReport('Data replication Test', totalNodes, runDurationSec, aggregatedResults, passed);
    printTestReport(report);
  });
});
