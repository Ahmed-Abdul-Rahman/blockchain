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
    expect(computeLateJoinerPollTimeoutMs(6, 15_000)).toBe(150_000);
    expect(computeProducerConsensusTimeoutMs(6)).toBe(90_000);
  });

  it('scales mesh and poll windows for large clusters', () => {
    expect(computeMeshStabilizeMs(50)).toBe(340_000);
    expect(computeReplicateSettleMs(50)).toBe(118_000);
    expect(computeLateJoinerPollTimeoutMs(50, 15_000)).toBe(340_000);
    expect(computeProducerConsensusTimeoutMs(50)).toBe(250_000);
  });
});
