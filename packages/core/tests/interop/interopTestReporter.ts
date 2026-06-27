import assert from 'node:assert';
import { parseArg } from './helper';
import { AggregatedResult, TestReport, WorkerResult } from './types';

export const readInteropCliArgs = () => ({
  totalNodesArg: parseArg<number>('nodes'),
  runDurationSecArg: parseArg<number>('duration'),
  messageRateArg: parseArg<number>('rate'),
  pubsubTopicArg: parseArg<string>('topic'),
  networkIdArg: parseArg<string>('net'),
});

export const generateTestReport = (
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

export const printTestReport = (report: TestReport): void => {
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

export const assertStartupWorkerResults = (workerResults: WorkerResult[], totalNodes: number): boolean => {
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

  return passed;
};
