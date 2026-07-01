import type { Worker } from 'node:worker_threads';
import type { WorkerResult } from './types';

/** Result of polling a worker until a stats predicate succeeds or timeout */
export type PollResult = {
  readonly converged: boolean;
  readonly elapsedMs: number;
  readonly lastStats?: WorkerResult;
};

/** When true, interop scenarios use metric-based polling instead of fixed sleep waits */
export const isAdaptiveInteropStrict = (): boolean => process.env.ADAPTIVE_INTEROP_STRICT === 'true';

/**
 * Poll a worker's statistics until predicate(stats) is true or timeout elapses.
 */
export const pollWorkerStats = (
  workerRef: Worker,
  predicate: (stats: WorkerResult) => boolean,
  intervalMs: number,
  timeoutMs: number,
): Promise<PollResult> => {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let lastStats: WorkerResult | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (poll) clearInterval(poll);
      if (timeout) clearTimeout(timeout);
      workerRef.off('message', listener);
    };

    // biome-ignore lint/suspicious/noExplicitAny: worker message format is dynamic
    const listener = (msg: any) => {
      if (msg.type !== 'statistics' || !msg.stats) {
        return;
      }
      lastStats = msg.stats as WorkerResult;
      if (predicate(lastStats)) {
        cleanup();
        resolve({ converged: true, elapsedMs: Date.now() - startedAt, lastStats });
      }
    };

    workerRef.on('message', listener);
    poll = setInterval(() => {
      workerRef.postMessage({ type: 'statistics' });
    }, intervalMs);
    timeout = setTimeout(() => {
      cleanup();
      resolve({ converged: false, elapsedMs: Date.now() - startedAt, lastStats });
    }, timeoutMs);

    workerRef.postMessage({ type: 'statistics' });
  });
};

/** Poll until worker reports all expected target hashes are present */
export const pollWorkerTargetData = (workerRef: Worker, timeoutMs: number, intervalMs = 2_000): Promise<PollResult> =>
  pollWorkerStats(workerRef, (stats) => stats.hasTargetData === true, intervalMs, timeoutMs);

/** Poll every worker until all report hasTargetData */
export const pollAllWorkersTargetData = async (
  workerRefs: readonly Worker[],
  timeoutMs: number,
  intervalMs = 2_000,
): Promise<{ readonly allConverged: boolean; readonly results: readonly PollResult[] }> => {
  const results = await Promise.all(workerRefs.map((ref) => pollWorkerTargetData(ref, timeoutMs, intervalMs)));
  return {
    allConverged: results.every((r) => r.converged),
    results,
  };
};
