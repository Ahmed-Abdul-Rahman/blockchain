import { SyncIncompleteReason } from '../types';
import { AntiEntropyMetricsStore } from './AntiEntropyMetricsStore';
import { clamp } from './math';
import { StateVector } from './types';

/** Reference duration (30 s) for normalizing mean sync duration to [0, 1] */
const MEAN_DURATION_NORMALIZER_MS = 30_000;

/** Reference hash count (50) for normalizing mean hashes per sync to [0, 1] */
const MEAN_HASHES_NORMALIZER = 50;

/**
 * Builds normalized state vectors from the metrics store per ADR-0003.
 * Index order is stable for future ML compatibility.
 */
export class StateVectorBuilder {
  /**
   * @param metrics Queryable anti-entropy metrics store
   * @param maxIntervalMs Ceiling interval used to normalize time-since gauges
   */
  constructor(
    private readonly metrics: AntiEntropyMetricsStore,
    private readonly maxIntervalMs: number,
  ) {}

  /** Build the 7-element global state vector for scheduler heuristics */
  build(now: number): StateVector {
    const outcomes = this.metrics.getSyncAttemptOutcomes();
    const durations = this.metrics.getSyncAttemptDurations();
    const hashes = this.metrics.getSyncHashesDiscovered();
    const windowSize = Math.max(1, this.metrics.getWindowSize());
    const incompleteReasons = this.metrics.getIncompleteReasonCounts();

    const successCount = outcomes.filter(Boolean).length;
    const syncSuccessRate = successCount / windowSize;

    const timeoutCount = incompleteReasons.get('timeout') ?? 0;
    const syncTimeoutRate = timeoutCount / windowSize;

    const meanDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const meanSyncDuration = clamp(meanDuration / MEAN_DURATION_NORMALIZER_MS, 0, 1);

    const timeSinceLastSyncMs = this.metrics.getTimeSinceLastSyncMs(now);
    const timeSinceLastSync = clamp(timeSinceLastSyncMs / this.maxIntervalMs, 0, 1);

    const timeSinceLastUsefulSyncMs = this.metrics.getTimeSinceLastUsefulSyncMs(now);
    const timeSinceLastUsefulSync = clamp(timeSinceLastUsefulSyncMs / this.maxIntervalMs, 0, 1);

    const replicationActivityRate = clamp(this.metrics.getActivityTracker().getRatePerMinute(now), 0, 1);

    const meanHashes = hashes.length > 0 ? hashes.reduce((a, b) => a + b, 0) / hashes.length : 0;
    const meanHashesPerSync = clamp(meanHashes / MEAN_HASHES_NORMALIZER, 0, 1);

    return [
      syncSuccessRate,
      syncTimeoutRate,
      meanSyncDuration,
      timeSinceLastSync,
      timeSinceLastUsefulSync,
      replicationActivityRate,
      meanHashesPerSync,
    ];
  }

  /**
   * Build an 8-element per-peer vector: indices 0–6 match the global vector,
   * index 7 is the peer's convergence score.
   */
  buildForPeer(peerId: string, now: number): readonly number[] {
    const global = this.build(now);
    const peerScore = this.metrics.getPeerConvergenceTracker().getScore(peerId);
    return [...global, peerScore];
  }
}

/** Type alias for incomplete reason counter keys */
export type IncompleteReasonKey = SyncIncompleteReason;
