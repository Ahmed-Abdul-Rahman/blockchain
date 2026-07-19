import { describe, expect, it } from 'vitest';
import { partitionsDiverged, splitPartitionIndices } from '../../compose-interop/scenarios/splitBrainPartitions';

describe('splitPartitionIndices', () => {
  it('splits an even cohort into two equal partitions', () => {
    const { half, partitionA, partitionB } = splitPartitionIndices(6);
    expect(half).toBe(3);
    expect(partitionA).toEqual([0, 1, 2]);
    expect(partitionB).toEqual([3, 4, 5]);
  });

  it('rejects odd or too-small totals', () => {
    expect(() => splitPartitionIndices(5)).toThrow(/even/);
    expect(() => splitPartitionIndices(2)).toThrow(/>= 4/);
  });
});

describe('partitionsDiverged', () => {
  it('detects divergent hash sets', () => {
    expect(partitionsDiverged(['a', 'b'], ['b', 'c'])).toBe(true);
    expect(partitionsDiverged(['a'], ['a'])).toBe(false);
    expect(partitionsDiverged([], ['a'])).toBe(false);
  });
});
