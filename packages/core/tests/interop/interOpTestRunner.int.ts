import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseArg } from './helper';
import { simulateBurstPeersAtStartUp, simulatePeerChurn, simulateStaggeredPeersAtStartUp } from './InterOpScenarios';

const totalNodesArg: number = parseArg('nodes');
const runDurationSecArg: number = parseArg('duration');
const messageRateArg: number = parseArg('rate');
const pubsubTopicArg: string = parseArg('topic');
const networkIdArg: string = parseArg('net');

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
    workerResults.forEach((workerResult) => {
      assert.equal(workerResult.verified, totalNodes - 1);
      assert.ok(workerResult.connections > totalNodes / 3);
    });
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
    workerResults.forEach((workerResult) => {
      assert.equal(workerResult.verified, totalNodes - 1);
      assert.ok(workerResult.connections > totalNodes / 3);
    });
  });
});

describe('P2P Network Integration Stability Tests', () => {
  it(`Peer Churn - Random peers drop and rejoin with same peerId - total running nodes ${10}`, async () => {
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
    workerResults.forEach((workerResult) => {
      assert.equal(workerResult.verified, totalNodes - 1);
      assert.ok(workerResult.connections > totalNodes / 3);
    });
  });
});
