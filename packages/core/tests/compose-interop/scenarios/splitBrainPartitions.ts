/** Pure helpers for Compose split-brain cohort indexing (unit-tested). */

export type SplitPartitions = {
  readonly partitionA: readonly number[];
  readonly partitionB: readonly number[];
  readonly half: number;
};

/** Split even totalNodes into two equal partitions [0..half) and [half..N). */
export const splitPartitionIndices = (totalNodes: number): SplitPartitions => {
  if (totalNodes < 4 || totalNodes % 2 !== 0) {
    throw new Error(
      `totalNodes must be an even number >= 4 (got ${totalNodes}). Each partition needs at least 2 nodes.`,
    );
  }
  const half = totalNodes / 2;
  return {
    half,
    partitionA: Array.from({ length: half }, (_, i) => i),
    partitionB: Array.from({ length: half }, (_, i) => i + half),
  };
};

/** True when two hash sets are not equal (partition produced divergent data). */
export const partitionsDiverged = (sideA: readonly string[], sideB: readonly string[]): boolean => {
  if (sideA.length === 0 || sideB.length === 0) return false;
  const a = new Set(sideA);
  const b = new Set(sideB);
  for (const h of a) {
    if (!b.has(h)) return true;
  }
  for (const h of b) {
    if (!a.has(h)) return true;
  }
  return false;
};
