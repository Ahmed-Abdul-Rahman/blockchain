import { parentPort, threadId, workerData } from 'node:worker_threads';
import { logger } from '@dechat/common';
import { createWorkerThreadTransport, startNodeRunner } from '../nodeRunner';
import { WorkerData } from '../types';

// Prevent libp2p background dial rejections from crashing the worker thread.
process.on('unhandledRejection', (reason) => {
  logger.warn(`[Worker ${threadId}] Suppressed unhandledRejection: ${String(reason)}`);
});

const config = workerData as WorkerData;

if (parentPort === null) {
  throw new Error('nodeWorkerData must run inside a worker thread with parentPort');
}

const port = parentPort;
const transport = createWorkerThreadTransport(port, (code) => {
  process.exit(code);
});

startNodeRunner(config, transport, { logLabel: `Worker ${threadId}` }).catch((error: unknown) => {
  console.log(`Caught worker ${threadId} error with threadId: `, error);
  port.postMessage({ type: 'error', error: String(error) });
  process.exit(1);
});
