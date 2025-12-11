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
import { aggregateResults, createWorker, terminateWorker, terminateWorkers } from './workerUtils';

const filename = fileURLToPath(import.meta.url);
const workerPath = resolve(dirname(filename), './nodeWorker.js');

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
        createWorker(workerPath, workerData, workerResults, handleComplete, handleWorkerError, terminationPromises),
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
        createWorker(workerPath, workerData, workerResults, handleComplete, handleWorkerError, terminationPromises),
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
        createWorker(workerPath, workerData, workerResults, handleComplete, handleWorkerError, terminationPromises),
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
        workerPath,
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
