export interface BenchResult {
  readonly iterations: number;
  readonly opsPerSec: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
}

export interface EventLoopDelayResult {
  readonly iterations: number;
  readonly meanMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
};

export const warmup = (fn: () => void, iterations = 50): void => {
  for (let i = 0; i < iterations; i++) {
    fn();
  }
};

export const benchSync = (fn: () => void, iterations: number): BenchResult => {
  const latenciesMs: number[] = [];
  const startedAt = performance.now();

  for (let i = 0; i < iterations; i++) {
    const opStart = performance.now();
    fn();
    latenciesMs.push(performance.now() - opStart);
  }

  const elapsedMs = performance.now() - startedAt;
  const meanMs = latenciesMs.reduce((sum, value) => sum + value, 0) / latenciesMs.length;

  return {
    iterations,
    opsPerSec: (iterations / elapsedMs) * 1000,
    meanMs,
    p50Ms: percentile(latenciesMs, 50),
    p99Ms: percentile(latenciesMs, 99),
  };
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatNumber = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a';

export const speedup = (baseline: number, candidate: number): number =>
  baseline > 0 ? baseline / candidate : Number.POSITIVE_INFINITY;
