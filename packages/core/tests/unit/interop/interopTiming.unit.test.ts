import { describe, expect, it } from 'vitest';
import {
  computeLateJoinerPollTimeoutMs,
  computeMeshStabilizeMs,
  computeProducerConsensusTimeoutMs,
  computeReplicateSettleMs,
} from '../../interop/interopTiming';

describe('interopTiming', () => {
  it('keeps base timings at 6 nodes', () => {
    expect(computeMeshStabilizeMs(6)).toBe(120_000);
    expect(computeReplicateSettleMs(6)).toBe(30_000);
    expect(computeLateJoinerPollTimeoutMs(6, 15_000)).toBe(240_000);
    expect(computeProducerConsensusTimeoutMs(6)).toBe(120_000);
  });

  it('scales mesh and poll windows for large clusters with CI headroom', () => {
    // 50-node late-joiner poll must exceed observed borderline convergence (~335s)
    expect(computeMeshStabilizeMs(50)).toBe(384_000);
    expect(computeReplicateSettleMs(50)).toBe(162_000);
    expect(computeLateJoinerPollTimeoutMs(50, 15_000)).toBe(560_000);
    expect(computeProducerConsensusTimeoutMs(50)).toBe(382_000);
  });

  it('does not reduce 6-node PR-CI minimums below anti-entropy tick budget', () => {
    // At least 12 sync intervals + 60s so usefulSyncs can accumulate under load
    expect(computeLateJoinerPollTimeoutMs(6, 15_000)).toBeGreaterThanOrEqual(15_000 * 12 + 60_000);
  });
});
