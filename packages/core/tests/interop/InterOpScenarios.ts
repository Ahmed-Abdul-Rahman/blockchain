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

export const simulatePeerChurn = async (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const terminationPromises: Promise<boolean>[] = [];
    const { totalNodes } = workerDataConfig;

    for (let i = 0; i < totalNodes; i++) {
      const nodeSeed = `Test-Node-Worker-${i}`;
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      workers.push(
        createWorker(nodeWorkerPath, workerData, workerResults, handleComplete, handleWorkerError, terminationPromises),
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
      );
      workers[index] = revivedWorker;
    });

    await delay(workerDataConfig.runDurationSec * 1000);
    terminateWorkers(workers);
    await Promise.all(terminationPromises);
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
