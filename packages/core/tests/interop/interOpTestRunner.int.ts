import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseArg } from './helper';
import {
  simulateAntiEntropyConvergence,
  simulateBurstPeersAtStartUp,
  simulateBurstPeersAtStartUpWithDataPropagation,
  simulateBurstPeersAtStartUpWithPropagationAndReplication,
  simulateIterativeDataFetch,
  simulateOfflinePeerRevivalConvergence,
  simulatePeerChurn,
  simulateSplitBrainConvergence,
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
      testType: 'PROPAGATION',
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
      const seenMessagesOk = workerResult.seenMessages?.reduce((prevSeen, { topic, seen }) => {
        if (topic === '/deChat/v1/topic/replication-protocol') {
          return prevSeen;
        }
        return seen === 22 && prevSeen;
      }, true);
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
      testType: 'REPLICATION',
      replicationType: 'K_REPLICA',
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
      const seenMessagesOk = workerResult.seenMessages?.reduce((prevSeen, { topic, seen }) => {
        if (topic === '/deChat/v1/topic/replication-protocol') {
          return seen > 0 && prevSeen;
        }
        return seen === 22 && prevSeen;
      }, true);
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

describe('Interop - DHT Routing and Iterative Fetching', () => {
  it(`should successfully fetch missing data from the K-closest peers via iterative routing`, async () => {
    const totalNodes = totalNodesArg ?? 12;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];

    const aggregatedResults = await simulateIterativeDataFetch({
      testType: 'REPLICATION',
      replicationType: 'K_REPLICA',
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
      dataSyncEnabled: false,
    });

    const { workerResults } = aggregatedResults;
    const fetchNodeResult = workerResults.find((r) => r.hasTargetData !== undefined);

    let passed = true;

    if (!fetchNodeResult || !fetchNodeResult.hasTargetData) {
      passed = false;
      console.log(`⚠️ Fetching Node failed to retrieve all missing hashes via DHT.`);
    }

    assert.ok(fetchNodeResult?.hasTargetData, `Node failed to iteratively fetch target data`);

    const report = generateTestReport('DHT Iterative Fetch', totalNodes, runDurationSec, aggregatedResults, passed);
    printTestReport(report);
  });
});

describe('Interop - Data Convergence (Anti-Entropy) Tests', () => {
  it(`should converge a late-joining peer's store via background anti-entropy sync`, async () => {
    const totalNodes = totalNodesArg ?? 6;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];
    const syncIntervalMs = 15_000;

    const aggregatedResults = await simulateAntiEntropyConvergence({
      testType: 'REPLICATION',
      replicationType: 'TOPIC_BASED',
      dataSyncEnabled: true,
      syncIntervalMs,
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
    });

    const { workerResults } = aggregatedResults;

    // The late joiner is the only node given an expected-hash set, so it is the
    // only result carrying hasTargetData.
    const lateJoiner = workerResults.find((r) => r.hasTargetData !== undefined);
    const producers = workerResults.filter((r) => r.hasTargetData === undefined);
    const maxProducerReplicaCount = Math.max(0, ...producers.map((r) => r.replicaCount ?? 0));

    let passed = true;

    if (!lateJoiner || !lateJoiner.hasTargetData) {
      passed = false;
      console.log(`⚠️ Late joiner failed to converge via anti-entropy. replicaCount: ${lateJoiner?.replicaCount}`);
    }

    if (lateJoiner && (lateJoiner.replicaCount ?? 0) < maxProducerReplicaCount) {
      passed = false;
      console.log(
        `⚠️ Late joiner store incomplete: ${lateJoiner.replicaCount} < producer max ${maxProducerReplicaCount}`,
      );
    }

    assert.ok(lateJoiner?.hasTargetData, `Late joiner failed to converge missing hashes via anti-entropy`);
    assert.ok(
      (lateJoiner?.replicaCount ?? 0) >= maxProducerReplicaCount,
      `Late joiner store (${lateJoiner?.replicaCount}) did not reach producer store size (${maxProducerReplicaCount})`,
    );

    const report = generateTestReport(
      'Anti-Entropy Convergence',
      totalNodes,
      runDurationSec,
      aggregatedResults,
      passed,
    );
    printTestReport(report);
  });

  it(`should converge a revived (dropped then restored) peer's store via background anti-entropy sync`, async () => {
    const totalNodes = totalNodesArg ?? 12;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];
    const syncIntervalMs = 15_000;

    const aggregatedResults = await simulateOfflinePeerRevivalConvergence({
      testType: 'REPLICATION',
      replicationType: 'TOPIC_BASED',
      dataSyncEnabled: true,
      syncIntervalMs,
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
    });

    const { workerResults } = aggregatedResults;

    // The revived peer is the only node given an expected-hash set, so it is the
    // only result carrying hasTargetData.
    const revivedPeer = workerResults.find((r) => r.hasTargetData !== undefined);
    const survivors = workerResults.filter((r) => r.hasTargetData === undefined);
    const maxSurvivorReplicaCount = Math.max(0, ...survivors.map((r) => r.replicaCount ?? 0));

    let passed = true;

    if (!revivedPeer || !revivedPeer.hasTargetData) {
      passed = false;
      console.log(`⚠️ Revived peer failed to converge via anti-entropy. replicaCount: ${revivedPeer?.replicaCount}`);
    }

    if (revivedPeer && (revivedPeer.replicaCount ?? 0) < maxSurvivorReplicaCount) {
      passed = false;
      console.log(
        `⚠️ Revived peer store incomplete: ${revivedPeer.replicaCount} < network max ${maxSurvivorReplicaCount}`,
      );
    }

    assert.ok(revivedPeer?.hasTargetData, `Revived peer failed to converge missing hashes via anti-entropy`);
    assert.ok(
      (revivedPeer?.replicaCount ?? 0) >= maxSurvivorReplicaCount,
      `Revived peer store (${revivedPeer?.replicaCount}) did not reach network store size (${maxSurvivorReplicaCount})`,
    );

    const report = generateTestReport(
      'Anti-Entropy Revival Convergence',
      totalNodes,
      runDurationSec,
      aggregatedResults,
      passed,
    );
    printTestReport(report);
  });

  it(`should converge both sides of a split-brain partition via background anti-entropy sync`, async () => {
    const totalNodes = totalNodesArg ?? 6;
    const runDurationSec = runDurationSecArg ?? 300;
    const messageRate = messageRateArg ?? 5;
    const pubsubTopic = pubsubTopicArg ?? '/bench/1';
    const networkId = networkIdArg ?? 'benchnet-1';
    const bootstrapMultiaddrs = [];
    const syncIntervalMs = 15_000;

    const aggregatedResults = await simulateSplitBrainConvergence({
      testType: 'REPLICATION',
      replicationType: 'TOPIC_BASED',
      dataSyncEnabled: true,
      syncIntervalMs,
      totalNodes,
      runDurationSec,
      messageRate,
      pubsubTopic,
      networkId,
      bootstrapMultiaddrs,
    });

    const { workerResults } = aggregatedResults;
    const replicaCounts = workerResults.map((r) => r.replicaCount ?? 0);
    const maxReplicaCount = Math.max(0, ...replicaCounts);
    const minReplicaCount = replicaCounts.length > 0 ? Math.min(...replicaCounts) : 0;

    let passed = true;

    for (const result of workerResults) {
      if (!result.hasTargetData) {
        passed = false;
        console.log(
          `⚠️ Node ${result.me} failed to converge after split-brain heal. replicaCount: ${result.replicaCount}`,
        );
      }
    }

    if (minReplicaCount !== maxReplicaCount || maxReplicaCount === 0) {
      passed = false;
      console.log(`⚠️ Split-brain stores diverged after heal: min=${minReplicaCount}, max=${maxReplicaCount}`);
    }

    assert.ok(
      workerResults.every((r) => r.hasTargetData),
      'One or more nodes failed to converge the split-brain union via anti-entropy',
    );
    assert.ok(
      minReplicaCount === maxReplicaCount && maxReplicaCount > 0,
      `Nodes did not reach a uniform store size after split-brain heal (min=${minReplicaCount}, max=${maxReplicaCount})`,
    );

    const report = generateTestReport(
      'Anti-Entropy Split-Brain Convergence',
      totalNodes,
      runDurationSec,
      aggregatedResults,
      passed,
    );
    printTestReport(report);
  });
});
