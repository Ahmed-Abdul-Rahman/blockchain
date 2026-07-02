import { SyncAttemptRecord } from '../types';

/** Expected hash bucket for partial-sync reward normalization (no version vectors in DeChat) */
const PARTIAL_EXPECTED_HASHES = 10;

/**
 * DeChat-adapted Bengfort-style reward for epsilon-greedy peer selection.
 * Distinguishes converged complete syncs (0 hashes, +0.1) from failed attempts (0).
 */
export const computeSyncReward = (record: SyncAttemptRecord): number => {
  const { result } = record;

  if (result.kind === 'failed') {
    return 0;
  }

  if (result.kind === 'complete') {
    if (result.hashesDiscovered > 0) {
      return 0.5 + 0.1 * Math.min(1, result.hashesDiscovered / PARTIAL_EXPECTED_HASHES);
    }
    return 0.1;
  }

  return 0.05 * (result.hashesDiscovered / Math.max(1, PARTIAL_EXPECTED_HASHES));
};
