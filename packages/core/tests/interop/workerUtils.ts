import { Worker } from 'node:worker_threads';
import { average, percentile } from './helper';
import { AggregatedResult, WorkerData, WorkerDetails, WorkerResult } from './types';

export const aggregateResults = (results: WorkerResult[]): AggregatedResult => {
  const connections = results.map((r) => r.connections);
  const verified = results.map((r) => r.verified);
  const ttfvp = results.map((r) => r.ttfvpMs).filter((x) => x >= 0);

  return {
    workerResults: results,
    summary: {
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
    },
  };
};

export const createWorker = (
  workerPath: string,
  workerData: WorkerData,
  workerResults: WorkerResult[],
  onComplete: (results: WorkerResult[]) => void,
  onWorkerError: (index: number, error: unknown) => void,
  terminationPromises: Promise<boolean>[],
): WorkerDetails => {
  const { index, totalNodes } = workerData;
  const worker = new Worker(workerPath, {
    workerData: {
      ...workerData,
    },
  });

  worker.on('message', (message) => {
    if (message.type === 'done') {
      const stats = message.stats as WorkerResult;
      workerResults.push(stats);
      console.log(
        `[${index + 1}/${totalNodes}] done: node=${stats.me}, verified=${stats.verified}, connections=${stats.connections}`,
      );
      if (workerResults.length === totalNodes) onComplete(workerResults);
    } else if (message.type === 'statistics') {
      const stats = message.stats as WorkerResult;
      console.log(
        `[${index + 1}/${totalNodes}] done: node=${stats.me}, verified=${stats.verified}, connections=${stats.connections}`,
      );
    } else if (message.type === 'terminate') {
      terminationPromises.push(
        new Promise((resolve) => {
          resolve(true);
        }),
      );
    } else if (message.type === 'error') {
      console.error('worker error:', message.error);
    }
  });

  worker.on('error', (err) => {
    console.error('worker crashed:', err);
    onWorkerError(index, err);
  });

  if (process.env.LOG_WORKER_EXITS === 'true')
    worker.on('exit', (exitCode) => console.log('worker exited with code: ', exitCode));

  return { workerData, workerRef: worker };
};

export const terminateWorker = async (worker: Worker): Promise<void> => {
  try {
    await worker.terminate();
  } catch (err) {
    console.log('Could not terminate a worker: ', err);
  }
};

export const terminateWorkers = (workers: WorkerDetails[]): void => {
  workers.map(({ workerRef }) => workerRef.postMessage({ type: 'terminate' }));
};
