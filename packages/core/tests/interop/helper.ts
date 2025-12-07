import assert from 'node:assert';
import { expectedWorkerResult, WorkerResult } from './types';

export const assertWorkerResult = (result: WorkerResult, expectations: expectedWorkerResult): void => {
  for (const [key, expected] of Object.entries(expectations)) {
    const value = result[key];

    if (typeof expected === 'function') {
      assert.ok((expected as Function)(value), `Assertion failed for ${key}: got ${value}`);
    } else {
      assert.equal(value, expected, `Assertion failed for ${key}`);
    }
  }
};

export const percentile = (values: number[], q: number): number => {
  if (values.length === 0) return -1;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((q / 100) * (sorted.length - 1));
  return sorted[index];
};

export const average = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : -1;

export const parseArg = <T = string | number | boolean | undefined>(name: string, defaultValue?: T): T => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 && defaultValue) return defaultValue;
  if (index === -1) return undefined as T;
  const rawValue = process.argv[index + 1];
  if (rawValue === undefined) return true as T;
  return (/^\d+$/.test(rawValue) ? Number(rawValue) : rawValue) as T;
};

/**
 *  returns true if 'i' is in percent range of 'startPercent' and 'endPercent'
 * @param i
 * @param n
 * @param startPercent
 * @param endPercent
 * @returns
 */
export const isInPercentRange = (i: number, n: number, startPercent: number, endPercent: number): boolean => {
  const start = Math.floor((startPercent / 100) * n) + 1;
  const end = Math.floor((endPercent / 100) * n) + 1;
  return i >= start && i <= end;
};

type workerEvent = {
  startPercent: number;
  endPercent: number;
  delayMs: number;
};

/**
 *
 * computes the minimal total Runtime required for all the workers to be up and running
 * based on the number of workers 'n', 'events' and startUpBufferMs provided
 * @param n
 * @param workerEvents
 * @param startUpBufferMs default = 1000 ms
 * @returns
 */
export const computeTotalRuntime = (n: number, workerEvents: workerEvent[], startUpBufferMs: number = 1000): number => {
  let totalRuntimeMs = 0;
  for (let i = 1; i <= n; i++) {
    workerEvents.forEach(({ startPercent, endPercent, delayMs }) => {
      if (isInPercentRange(i, n, startPercent, endPercent)) {
        totalRuntimeMs += delayMs + startUpBufferMs;
      } else {
        totalRuntimeMs += startUpBufferMs;
      }
    });
  }
  return totalRuntimeMs;
};
