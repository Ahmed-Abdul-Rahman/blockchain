import { describe, expect, it } from 'vitest';
import { computeSyncReward } from '../../../../../src/data-convergence/scheduling/bandit/RewardFunction';
import { SyncAttemptRecord } from '../../../../../src/data-convergence/scheduling/types';

const record = (result: SyncAttemptRecord['result']): SyncAttemptRecord => ({
  peerId: 'peer-1',
  startedAt: Date.now(),
  durationMs: 50,
  result,
});

describe('computeSyncReward', () => {
  it('returns 0 for failed syncs', () => {
    expect(computeSyncReward(record({ kind: 'failed', durationMs: 50 }))).toBe(0);
  });

  it('returns 0.1 for converged complete syncs with zero hashes', () => {
    expect(computeSyncReward(record({ kind: 'complete', hashesDiscovered: 0, durationMs: 50 }))).toBe(0.1);
  });

  it('scales useful complete sync rewards up to 0.6', () => {
    expect(computeSyncReward(record({ kind: 'complete', hashesDiscovered: 5, durationMs: 50 }))).toBe(0.55);
    expect(computeSyncReward(record({ kind: 'complete', hashesDiscovered: 10, durationMs: 50 }))).toBe(0.6);
    expect(computeSyncReward(record({ kind: 'complete', hashesDiscovered: 20, durationMs: 50 }))).toBe(0.6);
  });

  it('gives partial credit for incomplete syncs', () => {
    expect(computeSyncReward(record({ kind: 'partial', hashesDiscovered: 5, durationMs: 50, reason: 'timeout' }))).toBe(
      0.025,
    );
  });
});
