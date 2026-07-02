import { describe, expect, it, vi } from 'vitest';
import { DynamicArmSet } from '../../../../../src/data-convergence/scheduling/bandit/DynamicArmSet';
import { EpsilonGreedyPolicy } from '../../../../../src/data-convergence/scheduling/bandit/EpsilonGreedyPolicy';

describe('EpsilonGreedyPolicy', () => {
  it('exploits the highest-reward arm when random draw is above epsilon', () => {
    const armSet = new DynamicArmSet(0.1);
    armSet.syncCandidates(['good-peer', 'bad-peer']);
    armSet.recordReward('good-peer', 0.8);
    armSet.recordReward('bad-peer', 0.1);

    const policy = new EpsilonGreedyPolicy(
      { epsilon: 0.2, epsilonDecayPerAttempts: 0, epsilonFloor: 0.05 },
      () => 0.9,
      (items) => ({ item: items[0], index: 0 }),
    );

    expect(policy.selectPeer(['good-peer', 'bad-peer'], armSet)).toBe('good-peer');
  });

  it('explores uniformly when random draw is below epsilon', () => {
    const armSet = new DynamicArmSet(0.1);
    armSet.syncCandidates(['peer-a', 'peer-b']);
    armSet.recordReward('peer-a', 0.9);
    armSet.recordReward('peer-b', 0.1);

    const policy = new EpsilonGreedyPolicy(
      { epsilon: 0.5, epsilonDecayPerAttempts: 0, epsilonFloor: 0.05 },
      () => 0.1,
      (items) => ({ item: items[1], index: 1 }),
    );

    expect(policy.selectPeer(['peer-a', 'peer-b'], armSet)).toBe('peer-b');
  });

  it('anneals epsilon after configured attempt intervals', () => {
    const policy = new EpsilonGreedyPolicy({
      epsilon: 0.2,
      epsilonDecayPerAttempts: 2,
      epsilonFloor: 0.05,
    });

    policy.onAttemptComplete();
    expect(policy.getEpsilon()).toBe(0.2);

    policy.onAttemptComplete();
    expect(policy.getEpsilon()).toBeCloseTo(0.19);
  });
});
