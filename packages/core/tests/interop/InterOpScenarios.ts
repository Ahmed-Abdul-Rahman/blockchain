import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AggregatedResult, WorkerData, WorkerResult } from './types';
import { aggregateResults, createWorker, terminateWorker } from './workerUtils';

const filename = fileURLToPath(import.meta.url);
const workerPath = resolve(dirname(filename), './nodeWorker.js');

export const simulateBurstPeersAtStartUp = (totalNodes: number): Promise<AggregatedResult> => {
  console.log(workerPath);
  const workers: Worker[] = [];
  const workerResults: WorkerResult[] = [];

  return new Promise((resolve, reject) => {
    const handleComplete = (results: WorkerResult[]) => {
      resolve(aggregateResults(results));
    };

    const handleWorkerError = async (err: unknown) => {
      await Promise.all(workers.map((worker) => terminateWorker(worker)));
      reject(err);
    };

    for (let i = 0; i < totalNodes; i++) {
      const workerData = {
        index: i,
        totalNodes,
        runDurationSec: 30,
        messageRate: 5,
        pubsubTopic: '/bench/1',
        networkId: 'benchnet-1',
        bootstrapMultiaddrs: [],
      } as WorkerData;

      createWorker(workerPath, workerData, workers, workerResults, handleComplete, handleWorkerError);
    }
  });
};
