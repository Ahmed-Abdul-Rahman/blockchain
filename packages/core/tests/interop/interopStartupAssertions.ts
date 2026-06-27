import assert from 'node:assert';
import { AggregatedResult } from './types';

export type StartupHealthProfile = 'standard' | 'churn';

const minVerifiedPeers = (totalNodes: number): number => totalNodes / 2;

const minConnectionsPerNode = (totalNodes: number): number => Math.max(2, Math.floor(totalNodes / 4));

export type StartupHealthEvaluation = {
  readonly passed: boolean;
  readonly failures: readonly string[];
};

export const evaluateStartupHealth = (
  aggregatedResults: AggregatedResult,
  totalNodes: number,
  profile: StartupHealthProfile,
): StartupHealthEvaluation => {
  const { workerResults, summary } = aggregatedResults;
  const minVerified = minVerifiedPeers(totalNodes);
  const minConnections = minConnectionsPerNode(totalNodes);
  const failures: string[] = [];

  if (profile === 'churn') {
    const minPassingMajority = Math.ceil(totalNodes * 0.5);
    const minVerifiedRevived = Math.max(2, Math.floor(totalNodes / 5));
    const nodesWithAnyConnection = workerResults.filter((r) => r.connections >= 1).length;
    const nodesPassingConnections = workerResults.filter((r) => r.connections >= minConnections).length;
    const nodesPassingVerified = workerResults.filter((r) => r.verified >= minVerified).length;
    const nodesKnowingPeers = workerResults.filter((r) => r.verified >= minVerifiedRevived).length;

    if (nodesWithAnyConnection < totalNodes) {
      failures.push(
        `${totalNodes - nodesWithAnyConnection}/${totalNodes} nodes have zero open connections after churn`,
      );
    }
    if (nodesKnowingPeers < totalNodes) {
      failures.push(
        `Only ${nodesKnowingPeers}/${totalNodes} nodes know >= ${minVerifiedRevived} verified peers after churn`,
      );
    }
    if (nodesPassingConnections < minPassingMajority) {
      failures.push(
        `Only ${nodesPassingConnections}/${totalNodes} nodes have >= ${minConnections} connections (need ${minPassingMajority})`,
      );
    }
    if (nodesPassingVerified < minPassingMajority) {
      failures.push(
        `Only ${nodesPassingVerified}/${totalNodes} nodes have >= ${minVerified} verified peers (need ${minPassingMajority})`,
      );
    }
    if (summary.verified.avg < minVerified) {
      failures.push(`Fleet average verified peers ${summary.verified.avg} below ${minVerified}`);
    }
    if (summary.verified.p50 < minVerified) {
      failures.push(`Fleet P50 verified peers ${summary.verified.p50} below ${minVerified}`);
    }

    workerResults.forEach((workerResult, index) => {
      const label = workerResult.index ?? index;
      if (
        workerResult.connections < 1 ||
        workerResult.verified < minVerifiedRevived ||
        workerResult.connections < minConnections ||
        workerResult.verified < minVerified
      ) {
        console.log(`⚠️  Node ${label} churn snapshot:`);
        console.log(
          `   Verified: ${workerResult.verified} (majority min: ${minVerified}, revived min: ${minVerifiedRevived})`,
        );
        console.log(`   Connections: ${workerResult.connections} (majority min: ${minConnections})`);
      }
    });

    return { passed: failures.length === 0, failures };
  }

  workerResults.forEach((workerResult, index) => {
    const label = workerResult.index ?? index;
    const verifiedOk = workerResult.verified >= minVerified;
    const connectionsOk = workerResult.connections >= minConnections;

    if (!verifiedOk || !connectionsOk) {
      failures.push(
        `Node ${label}: verified=${workerResult.verified} (min ${minVerified}), connections=${workerResult.connections} (min ${minConnections})`,
      );
      console.log(`⚠️  Node ${label} below threshold:`);
      console.log(`   Verified: ${workerResult.verified} (min: ${minVerified})`);
      console.log(`   Connections: ${workerResult.connections} (min: ${minConnections})`);
    }
  });

  return { passed: failures.length === 0, failures };
};

export const assertStartupHealth = (
  aggregatedResults: AggregatedResult,
  totalNodes: number,
  profile: StartupHealthProfile,
): void => {
  const evaluation = evaluateStartupHealth(aggregatedResults, totalNodes, profile);
  assert.ok(evaluation.passed, evaluation.failures.join('; '));
};
