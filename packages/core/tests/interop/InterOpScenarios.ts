import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleIndices } from '@dechat/common';
import { delay } from 'es-toolkit';
import { isInPercentRange } from './helper';
import {
  AggregatedResult,
  RunWorkersScenario,
  WorkerData,
  WorkerDataConfig,
  WorkerDetails,
  WorkerResult,
} from './types';
import { aggregateResults, createWorker, postMessageToWorkers, terminateWorker, terminateWorkers } from './workerUtils';

const filename = fileURLToPath(import.meta.url);
const nodeWorkerPath = resolve(dirname(filename), './childThread', './nodeWorker.js');
const nodeWorkerDataPropPath = resolve(dirname(filename), './childThread', './nodeWorkerData.js');

export const setupScenario = (
  runWorkersScenario: RunWorkersScenario,
): {
  workers: WorkerDetails[];
  workerResults: WorkerResult[];
  scenarioResults: Promise<AggregatedResult>;
} => {
  const workers: WorkerDetails[] = [];
  const workerResults: WorkerResult[] = [];

  const scenarioResults: Promise<AggregatedResult> = new Promise(async (resolve, reject) => {
    const handleComplete = (results: WorkerResult[]) => {
      resolve(aggregateResults(results));
    };

    const handleWorkerError = async (index: number, err: unknown) => {
      console.log('Error occured in worker thread with index: ', index);
      await Promise.all(
        workers.filter((_, curIndex) => curIndex !== index).map(({ workerRef }) => terminateWorker(workerRef)),
      );
      reject(err);
    };

    await runWorkersScenario(workers, workerResults, handleComplete, handleWorkerError);
  });

  return {
    workers,
    workerResults,
    scenarioResults,
  };
};

export const simulateBurstPeersAtStartUp = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    for (let i = 0; i < workerDataConfig.totalNodes; i++) {
      const nodeSeed = `Test-StartUp-Worker-${i}`;
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      workers.push(
        createWorker(nodeWorkerPath, workerData, workerResults, handleComplete, handleWorkerError, terminationPromises),
      );
    }
    await delay(workerDataConfig.runDurationSec * 1000);
    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateStaggeredPeersAtStartUp = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    const { totalNodes } = workerDataConfig;

    for (let i = 0; i < totalNodes; i++) {
      const nodeSeed = `Test-Staggered-Worker-${i}`;
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      if (isInPercentRange(i, totalNodes, 0, 50)) await delay(1);
      else if (isInPercentRange(i, totalNodes, 51, 90)) await delay(20_000);
      else await delay(60_000);
      workers.push(
        createWorker(nodeWorkerPath, workerData, workerResults, handleComplete, handleWorkerError, terminationPromises),
      );
    }
    await delay(workerDataConfig.runDurationSec * 1000);
    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

const finalizeChurnFromStatistics = (
  statsByIndex: Map<number, WorkerResult>,
  totalNodes: number,
  handleComplete: (results: WorkerResult[]) => void,
): void => {
  const results = Array.from({ length: totalNodes }, (_, index) => {
    const stats = statsByIndex.get(index);
    if (!stats) throw new Error(`Missing statistics snapshot for node index ${index}`);
    return stats;
  });
  handleComplete(results);
};

export const simulatePeerChurn = async (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    const churnStatsByIndex = new Map<number, WorkerResult>();
    const { totalNodes } = workerDataConfig;

    for (let i = 0; i < totalNodes; i++) {
      const nodeSeed = `Test-Node-Worker-${i}`;
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      workers.push(
        createWorker(
          nodeWorkerPath,
          workerData,
          workerResults,
          handleComplete,
          handleWorkerError,
          terminationPromises,
          churnStatsByIndex,
        ),
      );
    }

    await delay(180_000); // delay for 3mins so the network is stable
    workers.forEach((worker) => worker.workerRef.postMessage({ type: 'statistics' }));
    await delay(3000); // delay for 3seconds so we get the statistics

    const randomSampleIndices = sampleIndices(totalNodes, 3);
    await Promise.all(
      randomSampleIndices.map((index) => {
        const randomWorker = workers[index] as WorkerDetails;
        return terminateWorker(randomWorker.workerRef);
      }),
    );

    randomSampleIndices.forEach((index) => {
      console.log('Reviving peer with index: ', index);
      const randomWorker = workers[index] as WorkerDetails;
      const revivedWorker = createWorker(
        nodeWorkerPath,
        randomWorker.workerData,
        workerResults,
        handleComplete,
        handleWorkerError,
        terminationPromises,
        churnStatsByIndex,
      );
      workers[index] = revivedWorker;
    });

    const CHURN_RECONNECT_SETTLE_MS = 120_000;
    await delay(CHURN_RECONNECT_SETTLE_MS);
    await delay(workerDataConfig.runDurationSec * 1000);
    postMessageToWorkers(workers, { type: 'statistics' });
    await delay(15_000);
    finalizeChurnFromStatistics(churnStatsByIndex, totalNodes, handleComplete);
    await Promise.all(workers.map(({ workerRef }) => terminateWorker(workerRef)));
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateBurstPeersAtStartUpWithDataPropagation = (
  workerDataConfig: WorkerDataConfig,
): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    for (let i = 0; i < workerDataConfig.totalNodes; i++) {
      const nodeSeed = `Test-StartUp-Worker-${i}`;
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      workers.push(
        createWorker(
          nodeWorkerDataPropPath,
          workerData,
          workerResults,
          handleComplete,
          handleWorkerError,
          terminationPromises,
        ),
      );
    }

    await delay(180_000);
    postMessageToWorkers(workers, { type: 'produce_messages' });
    await delay(130_000);
    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateBurstPeersAtStartUpWithPropagationAndReplication = (
  workerDataConfig: WorkerDataConfig,
): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    for (let i = 0; i < workerDataConfig.totalNodes; i++) {
      const nodeSeed = `Test-StartUp-Worker-${i}`;
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      workers.push(
        createWorker(
          nodeWorkerDataPropPath,
          workerData,
          workerResults,
          handleComplete,
          handleWorkerError,
          terminationPromises,
        ),
      );
    }

    await delay(120_000);
    postMessageToWorkers(workers, { type: 'produce_messages_replication' });
    await delay(180_000);
    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateAntiEntropyConvergence = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  // Fast-profile timing. STABILIZE_MS matches the proven value used by
  // simulateBurstPeersAtStartUpWithPropagationAndReplication: the gossip mesh for the
  // replication topic must be fully formed before a node announces, otherwise gossipsub
  // throws PublishError.NoPeersSubscribedToTopic (allowPublishToZeroTopicPeers is false).
  const STABILIZE_MS = 120_000; // let the N-1 producer mesh form + exchange peers + subscribe
  const REPLICATE_SETTLE_MS = 30_000; // let produced messages fully replicate across producers
  const LATE_JOINER_CONNECT_MS = 20_000; // let the late joiner dial into the mesh
  const syncIntervalMs = workerDataConfig.syncIntervalMs ?? 15_000;
  const ANTI_ENTROPY_WAIT_MS = syncIntervalMs * 4 + 15_000; // several sync cycles + buffer

  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    const { totalNodes } = workerDataConfig;
    const producerCount = totalNodes - 1;
    const lateJoinerIndex = totalNodes - 1;

    // 1. Spawn the producer mesh (every node but the late joiner)
    for (let i = 0; i < producerCount; i++) {
      const nodeSeed = `Test-Convergence-Worker-${i}`;
      const workerData = { index: i, nodeSeed, ...workerDataConfig } as WorkerData;
      workers.push(
        createWorker(
          nodeWorkerDataPropPath,
          workerData,
          workerResults,
          handleComplete,
          handleWorkerError,
          terminationPromises,
        ),
      );
    }

    // 2. Stabilize, then produce + replicate messages across the producers
    await delay(STABILIZE_MS);
    postMessageToWorkers(workers, { type: 'produce_messages_replication' });
    await delay(REPLICATE_SETTLE_MS);

    // 3. Collect the union of stored content hashes from all producers
    const expectedHashes = await collectExpectedHashes(workers);
    console.log(`[Convergence Test] Producers hold ${expectedHashes.length} unique hashes`);

    // 4. Spawn the late joiner. GossipSub never re-delivers history, so the only path
    //    to these hashes is the background AntiEntropyManager.
    const lateJoinerSeed = `Test-Convergence-Worker-${lateJoinerIndex}`;
    const lateJoinerData = { index: lateJoinerIndex, nodeSeed: lateJoinerSeed, ...workerDataConfig } as WorkerData;
    const lateJoiner = createWorker(
      nodeWorkerDataPropPath,
      lateJoinerData,
      workerResults,
      handleComplete,
      handleWorkerError,
      terminationPromises,
    );
    workers.push(lateJoiner);

    // 5. Let it connect, tell it which hashes to expect (no manual fetch), then wait for sync
    await delay(LATE_JOINER_CONNECT_MS);
    lateJoiner.workerRef.postMessage({ type: 'set_expected_hashes', hashes: expectedHashes });
    await delay(ANTI_ENTROPY_WAIT_MS);

    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

/**
 * Requests the stored content hashes from every producer worker and returns their union.
 */
const collectExpectedHashes = async (producers: WorkerDetails[]): Promise<string[]> => {
  const reports = await Promise.all(
    producers.map(
      ({ workerRef }) =>
        new Promise<string[]>((resolve) => {
          // biome-ignore lint/suspicious/noExplicitAny: <Worker message format is dynamic>
          const listener = (msg: any) => {
            if (msg.type === 'hashes_report') {
              workerRef.off('message', listener);
              resolve(msg.hashes ?? []);
            }
          };
          workerRef.on('message', listener);
          workerRef.postMessage({ type: 'report_hashes' });
        }),
    ),
  );

  return Array.from(new Set(reports.flat()));
};

/**
 * Requests dialable listen multiaddrs from workers (127.0.0.1 preferred for same-host interop).
 */
type ListenAddrReport = { index: number; peerId: string; addrs: string[] };

const collectListenAddrReports = async (workers: WorkerDetails[]): Promise<ListenAddrReport[]> => {
  const reports = await Promise.all(
    workers.map(
      ({ workerRef }) =>
        new Promise<ListenAddrReport>((resolve) => {
          // biome-ignore lint/suspicious/noExplicitAny: <Worker message format is dynamic>
          const listener = (msg: any) => {
            if (msg.type === 'listen_addrs_report') {
              workerRef.off('message', listener);
              resolve({
                index: msg.index,
                peerId: msg.peerId ?? '',
                addrs: msg.addrs ?? [],
              });
            }
          };
          workerRef.on('message', listener);
          workerRef.postMessage({ type: 'report_listen_addrs' });
        }),
    ),
  );

  return reports.map((report) => ({
    ...report,
    addrs: Array.from(new Set(report.addrs)),
  }));
};

const collectListenAddrs = async (workers: WorkerDetails[]): Promise<string[]> => {
  const reports = await collectListenAddrReports(workers);
  return Array.from(new Set(reports.flatMap((r) => r.addrs)));
};

/**
 * Spawns an isolated partition: mDNS off, bootstrap-only within the partition.
 * Nodes start one at a time so each new member bootstraps to all previously
 * started peers (avoids PEX gossiping peer IDs without dialable multiaddrs).
 */
const spawnIsolatedPartition = async (
  workerDataConfig: WorkerDataConfig,
  indices: readonly number[],
  seedPrefix: string,
  workers: WorkerDetails[],
  workerResults: WorkerResult[],
  handleComplete: (results: WorkerResult[]) => void,
  handleWorkerError: (index: number, err: unknown) => Promise<void>,
  terminationPromises: Promise<boolean>[],
  firstNodeBootMs: number,
  partitionStabilizeMs: number,
): Promise<WorkerDetails[]> => {
  const partitionWorkers: WorkerDetails[] = [];
  let bootstrapAddrs: string[] = [];

  const makeWorkerData = (index: number, bootstrapMultiaddrs: string[]): WorkerData =>
    ({
      ...workerDataConfig,
      index,
      nodeSeed: `${seedPrefix}-${index}`,
      enableMdns: false,
      bootstrapMultiaddrs,
    }) as WorkerData;

  for (const idx of indices) {
    const worker = createWorker(
      nodeWorkerDataPropPath,
      makeWorkerData(idx, [...bootstrapAddrs]),
      workerResults,
      handleComplete,
      handleWorkerError,
      terminationPromises,
    );
    partitionWorkers.push(worker);
    workers.push(worker);

    await delay(firstNodeBootMs);
    bootstrapAddrs = await collectListenAddrs(partitionWorkers);
  }

  await delay(partitionStabilizeMs);
  console.log(`[Split-Brain] Partition ${seedPrefix} (${indices.length} nodes) addrs: ${bootstrapAddrs.length}`);
  return partitionWorkers;
};

/** Instructs each worker to dial every other peer's multiaddrs (never its own). */
const connectWorkersCrossPartition = async (workers: WorkerDetails[], reports: ListenAddrReport[]): Promise<void> => {
  await Promise.all(
    workers.map(
      ({ workerRef, workerData }) =>
        new Promise<void>((resolve) => {
          const selfReport = reports.find((r) => r.index === workerData.index);
          const targetAddrs = Array.from(
            new Set(reports.filter((r) => r.peerId !== selfReport?.peerId).flatMap((r) => r.addrs)),
          );

          // biome-ignore lint/suspicious/noExplicitAny: <Worker message format is dynamic>
          const listener = (msg: any) => {
            if (msg.type === 'connect_peers_done') {
              workerRef.off('message', listener);
              resolve();
            }
          };
          workerRef.on('message', listener);
          workerRef.postMessage({ type: 'connect_peers', multiaddrs: targetAddrs });
        }),
    ),
  );
};

export const simulateSplitBrainConvergence = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const FIRST_NODE_BOOT_MS = 15_000;
  const PARTITION_STABILIZE_MS = 90_000;
  const REPLICATE_SETTLE_MS = 30_000;
  const HEAL_CONNECT_MS = 45_000;
  const syncIntervalMs = workerDataConfig.syncIntervalMs ?? 15_000;
  const ANTI_ENTROPY_WAIT_MS = syncIntervalMs * 6 + 30_000;

  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    const { totalNodes } = workerDataConfig;

    if (totalNodes < 4 || totalNodes % 2 !== 0) {
      throw new Error(
        `[Split-Brain] totalNodes must be an even number >= 4 (got ${totalNodes}). ` +
          'Each partition needs at least 2 nodes for gossip replication.',
      );
    }

    const half = totalNodes / 2;
    const partitionAIndices = Array.from({ length: half }, (_, i) => i);
    const partitionBIndices = Array.from({ length: half }, (_, i) => i + half);

    // 1. Spin up two isolated partitions (no mDNS, bootstrap-only within each side).
    const partitionA = await spawnIsolatedPartition(
      workerDataConfig,
      partitionAIndices,
      'Test-SplitBrain-A',
      workers,
      workerResults,
      handleComplete,
      handleWorkerError,
      terminationPromises,
      FIRST_NODE_BOOT_MS,
      PARTITION_STABILIZE_MS,
    );

    const partitionB = await spawnIsolatedPartition(
      workerDataConfig,
      partitionBIndices,
      'Test-SplitBrain-B',
      workers,
      workerResults,
      handleComplete,
      handleWorkerError,
      terminationPromises,
      FIRST_NODE_BOOT_MS,
      PARTITION_STABILIZE_MS,
    );

    // 2. Each side produces and replicates messages independently while partitioned.
    postMessageToWorkers(partitionA, { type: 'produce_messages_replication' });
    await delay(REPLICATE_SETTLE_MS);
    const sideAHashes = await collectExpectedHashes(partitionA);
    console.log(`[Split-Brain] Side A produced ${sideAHashes.length} unique hashes`);

    postMessageToWorkers(partitionB, { type: 'produce_messages_replication' });
    await delay(REPLICATE_SETTLE_MS);
    const sideBHashes = await collectExpectedHashes(partitionB);
    console.log(`[Split-Brain] Side B produced ${sideBHashes.length} unique hashes`);

    const expectedUnion = Array.from(new Set([...sideAHashes, ...sideBHashes]));
    console.log(`[Split-Brain] Expected union after heal: ${expectedUnion.length} unique hashes`);

    // 3. Heal the partition: each node dials every peer on the other side (and within its side).
    const addrReports = await collectListenAddrReports([...partitionA, ...partitionB]);
    console.log(
      `[Split-Brain] Healing partition via ${addrReports.flatMap((r) => r.addrs).length} dialable addrs across ${addrReports.length} nodes`,
    );
    await connectWorkersCrossPartition(workers, addrReports);
    await delay(HEAL_CONNECT_MS);
    // Retry once so stragglers pick up peers that finished authenticating late.
    await connectWorkersCrossPartition(workers, addrReports);
    await delay(HEAL_CONNECT_MS);

    // 4. Tell every node the full union we expect anti-entropy to deliver (no manual fetch).
    for (const { workerRef } of workers) {
      workerRef.postMessage({ type: 'set_expected_hashes', hashes: expectedUnion });
    }
    await delay(ANTI_ENTROPY_WAIT_MS);

    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateOfflinePeerRevivalConvergence = (
  workerDataConfig: WorkerDataConfig,
): Promise<AggregatedResult> => {
  // Scaled-up timing for the standard 12-node config (relative to the 6-node late-joiner test).
  // STABILIZE_MS matches the proven peer-churn stabilization window so the full mesh + replication
  // topic subscriptions are established before any node announces.
  const STABILIZE_MS = 180_000; // let all nodes form the mesh, exchange peers + subscribe
  const PROPAGATE_SETTLE_MS = 60_000; // let produced messages fully replicate across the network
  const RECONNECT_MS = 30_000; // let the revived peer rediscover + re-authenticate into the mesh
  const syncIntervalMs = workerDataConfig.syncIntervalMs ?? 15_000;
  const ANTI_ENTROPY_WAIT_MS = syncIntervalMs * 6 + 30_000; // several sync cycles + generous buffer

  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    const { totalNodes } = workerDataConfig;

    // 1. Spin up every node
    for (let i = 0; i < totalNodes; i++) {
      const nodeSeed = `Test-Revival-Convergence-Worker-${i}`;
      const workerData = { index: i, nodeSeed, ...workerDataConfig } as WorkerData;
      workers.push(
        createWorker(
          nodeWorkerDataPropPath,
          workerData,
          workerResults,
          handleComplete,
          handleWorkerError,
          terminationPromises,
        ),
      );
    }

    // 2. Stabilize the mesh, produce messages, then let them propagate across the network
    await delay(STABILIZE_MS);
    postMessageToWorkers(workers, { type: 'produce_messages_replication' });
    await delay(PROPAGATE_SETTLE_MS);

    // 3. Snapshot the converged network state (under TOPIC_BASED every node holds the full set)
    const expectedHashes = await collectExpectedHashes(workers);
    console.log(`[Revival Convergence Test] Network holds ${expectedHashes.length} unique hashes before drop`);

    // 4. Drop one random peer
    const [dropIndex] = sampleIndices(totalNodes, 1);
    const droppedWorker = workers[dropIndex] as WorkerDetails;
    console.log(`[Revival Convergence Test] Dropping peer index ${dropIndex}`);
    await terminateWorker(droppedWorker.workerRef);

    // 5. Revive the SAME peer (same seed/identity) with a fresh, empty in-memory store.
    //    GossipSub never re-delivers history, so the revived node can only recover the
    //    pre-drop messages through the background AntiEntropyManager.
    console.log(`[Revival Convergence Test] Reviving peer index ${dropIndex}`);
    const revivedWorker = createWorker(
      nodeWorkerDataPropPath,
      droppedWorker.workerData,
      workerResults,
      handleComplete,
      handleWorkerError,
      terminationPromises,
    );
    workers[dropIndex] = revivedWorker;

    // 6. Let it reconnect, tell it which hashes anti-entropy must restore (no manual fetch),
    //    then wait for several sync cycles to converge.
    await delay(RECONNECT_MS);
    revivedWorker.workerRef.postMessage({ type: 'set_expected_hashes', hashes: expectedHashes });
    await delay(ANTI_ENTROPY_WAIT_MS);

    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateIterativeDataFetch = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];

    for (let i = 0; i < workerDataConfig.totalNodes; i++) {
      const nodeSeed = `Test-DHT-Worker-${i}`;
      const workerData = { index: i, nodeSeed, ...workerDataConfig } as WorkerData;
      workers.push(
        createWorker(
          nodeWorkerDataPropPath,
          workerData,
          workerResults,
          handleComplete,
          handleWorkerError,
          terminationPromises,
        ),
      );
    }

    // Wait for the network mesh to stabilize and peers to be exchanged
    await delay(120_000);

    // 1. Seed data on Node 0
    const seedNode = workers[0];
    const hashPromise = new Promise<string[]>((resolve) => {
      // biome-ignore lint/suspicious/noExplicitAny: <Message format is dynamic here>
      const listener = (msg: any) => {
        if (msg.type === 'target_hash_generated') {
          seedNode.workerRef.off('message', listener);
          resolve(msg.hashes);
        }
      };
      seedNode.workerRef.on('message', listener);
    });

    seedNode.workerRef.postMessage({ type: 'inject_seed_data' });
    const targetHashes = await hashPromise;
    console.log(`[DHT Test] Target hashes generated by Node 0: ${targetHashes.join(', ')}`);

    // Wait for K-replication to settle naturally via Gossip
    await delay(15_000);

    // 2. Fetch data from the last Node
    const fetchNodeIndex = workerDataConfig.totalNodes - 1;
    const fetchNode = workers[fetchNodeIndex];
    console.log(`[DHT Test] Instructing Node ${fetchNodeIndex} to fetch missing hashes.`);

    fetchNode.workerRef.postMessage({ type: 'fetch_target_data', hashes: targetHashes });

    // Wait for iterative routing to hop through the network and complete
    await delay(30_000);

    terminateWorkers(workers);
    await Promise.all(terminationPromises);
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};
