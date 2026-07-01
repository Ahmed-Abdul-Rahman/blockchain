import { Worker } from 'node:worker_threads';

export type WorkerResult = {
  me?: string | null;
  verified: number;
  connections: number;
  ttfvpMs: number; // time-to-first-verified-peer
  latencyP50: number;
  latencyP95: number;
  msgsObserved: number;
  seenMessages?: Array<{ topic: string; seen: number }>;
  directStreamMsgsReceivedCount?: number;
  replicaCount?: number;
  replicaDataDiff?: Array<unknown>;
  hasTargetData?: boolean; // Indicates if the node successfully fetched the target DHT hashes
  /** Anti-entropy sync metrics snapshot (when data sync is enabled) */
  antiEntropy?: {
    outboundAttempts: number;
    usefulSyncs: number;
    lastSyncHashes: number;
    /** Scheduled ticks skipped due to idle dormancy (adaptive mode) */
    idleSkips?: number;
    /** Forced syncs at maxIntervalMs ceiling despite idle state */
    floorSyncForces?: number;
    /** Total scheduled tick evaluations */
    scheduledTicks?: number;
    /** Consecutive zero-hash complete syncs at snapshot time */
    zeroHashStreak?: number;
    /** Replication activity score from state vector index 5 */
    activityScore?: number;
    /** Ms from set_expected_hashes to first full target hash coverage */
    convergenceMs?: number;
  };
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

export type AntiEntropyInteropSummary = {
  readonly lateJoiner?: WorkerResult['antiEntropy'];
  readonly producerIdleSkipsTotal: number;
  readonly producerOutboundAttemptsTotal: number;
  readonly producerFloorSyncForcesTotal: number;
  readonly producerScheduledTicksTotal: number;
};

export type AbComparisonReport = {
  readonly fixedWallMs: number;
  readonly heuristicWallMs: number;
  readonly fixed: AntiEntropyInteropSummary;
  readonly heuristic: AntiEntropyInteropSummary;
};

export interface TestReport {
  testName: string;
  totalNodes: number;
  duration: number;
  summary: Summary;
  passed: boolean;
  timestamp: string;
  antiEntropy?: AntiEntropyInteropSummary;
  scenarioWallMs?: number;
  abComparison?: AbComparisonReport;
}

export type AggregatedResult = {
  workerResults: WorkerResult[];
  summary: Summary;
};

export type AbComparisonResult = {
  readonly fixed: { readonly result: AggregatedResult; readonly wallMs: number };
  readonly heuristic: { readonly result: AggregatedResult; readonly wallMs: number };
};

export type WorkerData = {
  index: number;
  testType?: 'STARTUP' | 'PROPAGATION' | 'REPLICATION';
  replicationType?: 'K_REPLICA' | 'TOPIC_BASED';
  nodeSeed: string;
  totalNodes: number;
  networkId: string;
  pubsubTopic: string;
  bootstrapMultiaddrs: string[];
  runDurationSec: number;
  messageRate: number; // msgs per second
  dataSyncEnabled: boolean;
  syncIntervalMs?: number; // anti-entropy sync interval override
  /** Partial override for adaptive synchronizer config */
  adaptive?: {
    enabled?: boolean;
    scheduler?: 'fixed' | 'heuristic' | 'bandit';
    minIntervalMs?: number;
    maxIntervalMs?: number;
  };
  enableMdns?: boolean; // default true; set false to isolate network partitions
};

export type WorkerDataConfig = {
  testType?: 'STARTUP' | 'PROPAGATION' | 'REPLICATION';
  replicationType?: 'K_REPLICA' | 'TOPIC_BASED';
  totalNodes: number;
  networkId: string;
  pubsubTopic: string;
  bootstrapMultiaddrs: string[];
  runDurationSec: number;
  messageRate: number; // msgs per second
  dataSyncEnabled: boolean;
  syncIntervalMs?: number; // anti-entropy sync interval override
  /** Partial override for adaptive synchronizer config */
  adaptive?: {
    enabled?: boolean;
    scheduler?: 'fixed' | 'heuristic' | 'bandit';
    minIntervalMs?: number;
    maxIntervalMs?: number;
  };
  enableMdns?: boolean; // default true; set false to isolate network partitions
};

export type WorkerDetails = { workerData: WorkerData; workerRef: Worker };

export type RunWorkersScenario = (
  workers: WorkerDetails[],
  workerResults: WorkerResult[],
  handleComplete: (results: WorkerResult[]) => void,
  handleWorkerError: (index: number, err: unknown) => Promise<void>,
) => Promise<void>;
