import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleIndices, wait } from '@dechat/common';
import { genEd25519KeyPair } from '../../src/auth';
import { computeTotalRuntime, isInPercentRange } from './helper';
import {
  AggregatedResult,
  RunWorkersScenario,
  WorkerData,
  WorkerDataConfig,
  WorkerDetails,
  WorkerResult,
} from './types';
import { aggregateResults, createWorker, terminateWorker } from './workerUtils';

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
      console.log('Inside HandlerWorkerError');
      await Promise.all(
        workers.filter((_, curIndex) => curIndex !== index).map(({ workerRef }) => terminateWorker(workerRef)),
      );
      console.log('Promise complete HandlerWorkerError');
      reject(err);
    };

    runWorkersScenario(workers, workerResults, handleComplete, handleWorkerError);
  });

  return {
    workers,
    workerResults,
    scenarioResults,
  };
};

export const simulateBurstPeersAtStartUp = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    for (let i = 0; i < workerDataConfig.totalNodes; i++) {
      const nodeSeed = await genEd25519KeyPair();
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
      } as WorkerData;

      workers.push(createWorker(workerPath, workerData, workerResults, handleComplete, handleWorkerError));
    }
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulateStaggeredPeersAtStartUp = (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const { totalNodes, runDurationSec } = workerDataConfig;

    const totalRuntimeSec =
      computeTotalRuntime(totalNodes, [
        { startPercent: 0, endPercent: 50, delayMs: 0 },
        { startPercent: 51, endPercent: 90, delayMs: 20000 },
        { startPercent: 91, endPercent: 100, delayMs: 60000 },
      ]) / 1000;

    const finalRuntimeDurationSec = runDurationSec > totalRuntimeSec ? runDurationSec : totalRuntimeSec + 60;

    for (let i = 0; i < totalNodes; i++) {
      const nodeSeed = await genEd25519KeyPair();
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
        runDurationSec: finalRuntimeDurationSec,
      } as WorkerData;

      if (isInPercentRange(i, totalNodes, 0, 50)) await wait(1);
      else if (isInPercentRange(i, totalNodes, 51, 90)) await wait(20000);
      else await wait(60000);
      workers.push(createWorker(workerPath, workerData, workerResults, handleComplete, handleWorkerError));
    }
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};

export const simulatePeerChurn = async (workerDataConfig: WorkerDataConfig): Promise<AggregatedResult> => {
  const scenario: RunWorkersScenario = async (workers, workerResults, handleComplete, handleWorkerError) => {
    const { totalNodes, runDurationSec } = workerDataConfig;
    const totalRuntimeSec = 270 + Math.ceil(totalNodes / 3) * 70;
    const finalRuntimeDurationSec = runDurationSec > totalRuntimeSec ? runDurationSec : totalRuntimeSec + 180;

    for (let i = 0; i < totalNodes; i++) {
      const nodeSeed = await genEd25519KeyPair();
      const workerData = {
        index: i,
        nodeSeed,
        ...workerDataConfig,
        runDurationSec: finalRuntimeDurationSec,
      } as WorkerData;

      workers.push(createWorker(workerPath, workerData, workerResults, handleComplete, handleWorkerError));
    }

    await wait(180000); // wait for 2mins so the network is stable
    const randomSampleIndices = sampleIndices(totalNodes, totalNodes / 3);

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
      );
      workers[index] = revivedWorker;
    });
  };

  const { scenarioResults } = setupScenario(scenario);
  return scenarioResults;
};
