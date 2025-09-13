import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

type WorkerResult = {
  me?: string;
  verified: number;
  connections: number;
  ttfvpMs: number; // time-to-first-verified-peer
};

type expectedWorkerResult = {
  verified: number;
  connections: number | ((number: number) => boolean);
};

type AggregatedStats = {
  nodes: number;
  connections: {
    p50: number;
    p95: number;
    avg: number;
  };
  verified: {
    p50: number;
    p95: number;
    avg: number;
  };
  ttfVerifiedMs: {
    p50: number;
    p95: number;
    avg: number;
  };
};

// --------------------
// CLI args parser
// --------------------
const parseArg = <T = string | number | boolean>(name: string, defaultValue: T): T => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return defaultValue;
  const rawValue = process.argv[index + 1];
  if (rawValue === undefined) return true as T;
  return (/^\d+$/.test(rawValue) ? Number(rawValue) : rawValue) as T;
};

// --------------------
// Config
// --------------------
const totalNodes: number = parseArg('nodes', 10);
const runDurationSec: number = parseArg('duration', 30);
const messageRate: number = parseArg('rate', 5);
const pubsubTopic: string = parseArg('topic', '/bench/1');
const networkId: string = parseArg('net', 'benchnet-1');
const bootstrapMultiaddrs: string[] = []; // can be filled with known seeds

const filename = fileURLToPath(import.meta.url);
const workerPath = resolve(dirname(filename), './SimulateSingleNode.int.js');

const expectedResult: expectedWorkerResult = {
  verified: totalNodes - 1,
  connections: (value) => value < totalNodes,
};

const assertWorkerResult = (result: WorkerResult, expectations: expectedWorkerResult) => {
  for (const [key, expected] of Object.entries(expectations)) {
    const value = result[key];

    if (typeof expected === 'function') {
      assert.ok((expected as Function)(value), `Assertion failed for ${key}: got ${value}`);
    } else {
      assert.equal(value, expected, `Assertion failed for ${key}`);
    }
  }
};

const percentile = (values: number[], q: number): number => {
  if (values.length === 0) return -1;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((q / 100) * (sorted.length - 1));
  return sorted[index];
};

// Average helper
const average = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : -1);

// Aggregate worker results into summary stats
const aggregateResults = (results: WorkerResult[]): AggregatedStats => {
  const connections = results.map((r) => r.connections);
  const verified = results.map((r) => r.verified);
  const ttfvp = results.map((r) => r.ttfvpMs).filter((x) => x >= 0);

  return {
    nodes: results.length,
    connections: {
      p50: percentile(connections, 50), // median
      p95: percentile(connections, 95), // 95th percentile (worst-case tail)
      avg: average(connections), // average
    },
    verified: {
      p50: percentile(verified, 50),
      p95: percentile(verified, 95),
      avg: average(verified),
    },
    ttfVerifiedMs: {
      p50: percentile(ttfvp, 50),
      p95: percentile(ttfvp, 95),
      avg: average(ttfvp),
    },
  };
};

const finish = (results: WorkerResult[]): void => {
  const summary = aggregateResults(results);
  try {
    results.forEach((workerResult) => {
      assertWorkerResult(workerResult, expectedResult);
    });
  } catch (err) {
    console.error('❌ Test failed:', (err as Error).message);
    process.exit(1);
  }
  console.log('✅ All assertions passed!');
  console.log('\n=== Aggregate Results ===');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
};

const results: { workerResults: WorkerResult[] } = { workerResults: [] };

const createWorker = (index: number, workers: Worker[]) => {
  const { workerResults } = results;

  const worker = new Worker(workerPath, {
    workerData: {
      idx: index,
      total: totalNodes,
      networkId,
      pubsubTopic,
      bootstrapMultiaddrs,
      runSeconds: runDurationSec,
      msgRate: messageRate,
    },
  });

  worker.on('message', (message) => {
    if (message.type === 'done') {
      const stats = message.stats as WorkerResult;
      workerResults.push(stats);
      console.log(
        `[${workerResults.length}/${totalNodes}] done: node=${stats.me}, verified=${stats.verified}, connections=${stats.connections}`,
      );
      if (workerResults.length === totalNodes) finish(workerResults);
    } else if (message.type === 'error') {
      console.error('worker error:', message.error);
    }
  });

  worker.on('error', (err) => console.error('worker crashed:', err));
  worker.on('exit', (exitCode) => console.log('worker exited with code: ', exitCode));

  workers.push(worker);
};

// --------------------
// Main simulation
// --------------------
const simulatePeers = async (): Promise<void> => {
  const workers: Worker[] = [];

  for (let i = 0; i < totalNodes; i++) {
    // await wait(Math.random() * 10000); // stagger creation of workers
    createWorker(i, workers);
  }
};

simulatePeers();
