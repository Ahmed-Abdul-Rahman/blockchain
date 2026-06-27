import { AggregatedResult, TestReport } from './types';

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
