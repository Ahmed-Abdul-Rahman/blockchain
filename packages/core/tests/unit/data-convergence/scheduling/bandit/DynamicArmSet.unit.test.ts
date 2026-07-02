import { describe, expect, it } from 'vitest';
import { DynamicArmSet } from '../../../../../src/data-convergence/scheduling/bandit/DynamicArmSet';

describe('DynamicArmSet', () => {
  it('prunes arms when peers disconnect', () => {
    const armSet = new DynamicArmSet(0.1);
    armSet.syncCandidates(['peer-a', 'peer-b']);
    armSet.recordReward('peer-a', 0.5);
    armSet.syncCandidates(['peer-b']);

    expect(armSet.snapshot().has('peer-a')).toBe(false);
    expect(armSet.snapshot().has('peer-b')).toBe(true);
  });

  it('returns optimistic prior for unexplored arms', () => {
    const armSet = new DynamicArmSet(0.1);
    armSet.syncCandidates(['new-peer']);
    expect(armSet.getAverageReward('new-peer')).toBe(0.1);
  });

  it('tracks running average reward per arm', () => {
    const armSet = new DynamicArmSet(0.1);
    armSet.syncCandidates(['peer-a']);
    armSet.recordReward('peer-a', 0.6);
    armSet.recordReward('peer-a', 0.2);

    expect(armSet.getAverageReward('peer-a')).toBeCloseTo(0.4);
  });
});
