import { pickRandom } from '@dechat/common';

/**
 * Linear interpolation between `a` and `b` by factor `t` clamped to [0, 1].
 * Used to map urgency [0, 1] to an interval between max and min bounds.
 */
export const lerp = (a: number, b: number, t: number): number => {
  const clamped = Math.max(0, Math.min(1, t));
  return a + (b - a) * clamped;
};

/**
 * Equal jitter in [0, maxMs]: returns a random value in the upper half of the range
 * plus half the max, matching the retry backoff pattern in AntiEntropyManager.
 */
export const equalJitter = (maxMs: number): number => {
  const half = maxMs / 2;
  return Math.round(half + Math.random() * half);
};

/**
 * Clamp a value to the inclusive range [min, max].
 */
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Weighted random selection. Falls back to uniform random when all weights are equal
 * or the total weight is non-positive, so unexplored peers stay reachable.
 */
export const weightedRandomPick = <T>(items: readonly T[], weightFn: (item: T) => number): T => {
  if (items.length === 0) {
    throw new Error('weightedRandomPick: candidates cannot be empty');
  }
  if (items.length === 1) {
    return items[0];
  }

  const weights = items.map(weightFn);
  const allEqual = weights.every((w) => w === weights[0]);
  if (allEqual) {
    return pickRandom([...items]).item;
  }

  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return pickRandom([...items]).item;
  }

  let remaining = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    remaining -= weights[i];
    if (remaining <= 0) {
      return items[i];
    }
  }
  return items[items.length - 1];
};
