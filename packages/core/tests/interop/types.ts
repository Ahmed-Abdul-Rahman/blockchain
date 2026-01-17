import { Worker } from 'node:worker_threads';

export type WorkerResult = {
  me?: string;
  verified: number;
  connections: number;
  ttfvpMs: number; // time-to-first-verified-peer
};

export type expectedWorkerResult = {
  verified: number;
  connections: number | ((number: number) => boolean);
};

export type Summary = {
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

export interface TestReport {
  testName: string;
  totalNodes: number;
  duration: number;
  summary: Summary;
  passed: boolean;
  timestamp: string;
}

export type AggregatedResult = {
  workerResults: WorkerResult[];
  summary: Summary;
};

export type WorkerData = {
  index: number;
  nodeSeed: string;
  totalNodes: number;
  networkId: string;
  pubsubTopic: string;
  bootstrapMultiaddrs: string[];
  runDurationSec: number;
  messageRate: number; // msgs per second
};

export type WorkerDataConfig = {
  totalNodes: number;
  networkId: string;
  pubsubTopic: string;
  bootstrapMultiaddrs: string[];
  runDurationSec: number;
  messageRate: number; // msgs per second
};

export type WorkerDetails = { workerData: WorkerData; workerRef: Worker };

export type RunWorkersScenario = (
  workers: WorkerDetails[],
  workerResults: WorkerResult[],
  handleComplete: (results: WorkerResult[]) => void,
  handleWorkerError: (index: number, err: unknown) => Promise<void>,
) => Promise<void>;
