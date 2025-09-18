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

export const parseArg = <T = string | number | boolean>(name: string, defaultValue: T): T => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return defaultValue;
  const rawValue = process.argv[index + 1];
  if (rawValue === undefined) return true as T;
  return (/^\d+$/.test(rawValue) ? Number(rawValue) : rawValue) as T;
};
