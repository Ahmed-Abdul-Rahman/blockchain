import { pickRandom } from '@dechat/common';
import { DynamicArmSet } from './DynamicArmSet';

export type EpsilonGreedyConfig = {
  readonly epsilon: number;
  readonly epsilonDecayPerAttempts: number;
  readonly epsilonFloor: number;
};

const DECAY_MULTIPLIER = 0.95;

/**
 * Epsilon-greedy peer selection over dynamic bandit arms.
 * Explores uniformly; exploits highest average reward with random tie-break.
 */
export class EpsilonGreedyPolicy {
  private currentEpsilon: number;
  private attemptCount = 0;

  constructor(
    private readonly config: EpsilonGreedyConfig,
    private readonly random: () => number = Math.random,
    private readonly pickRandomFn: typeof pickRandom = pickRandom,
  ) {
    this.currentEpsilon = config.epsilon;
  }

  /** Select a peer ID from candidates using epsilon-greedy over arm averages */
  selectPeer(candidatePeerIds: readonly string[], armSet: DynamicArmSet): string {
    if (candidatePeerIds.length === 0) {
      throw new Error('EpsilonGreedyPolicy.selectPeer: candidates cannot be empty');
    }
    if (candidatePeerIds.length === 1) {
      return candidatePeerIds[0];
    }

    if (this.random() < this.currentEpsilon) {
      return this.pickRandomFn([...candidatePeerIds]).item;
    }

    let bestReward = Number.NEGATIVE_INFINITY;
    const bestPeers: string[] = [];

    for (const peerId of candidatePeerIds) {
      const reward = armSet.getAverageReward(peerId);
      if (reward > bestReward) {
        bestReward = reward;
        bestPeers.length = 0;
        bestPeers.push(peerId);
      } else if (reward === bestReward) {
        bestPeers.push(peerId);
      }
    }

    return this.pickRandomFn(bestPeers).item;
  }

  /** Record a completed attempt and optionally anneal exploration rate */
  onAttemptComplete(): void {
    this.attemptCount++;

    const { epsilonDecayPerAttempts, epsilonFloor } = this.config;
    if (epsilonDecayPerAttempts <= 0) {
      return;
    }

    if (this.attemptCount % Math.round(epsilonDecayPerAttempts) === 0) {
      this.currentEpsilon = Math.max(epsilonFloor, this.currentEpsilon * DECAY_MULTIPLIER);
    }
  }

  getEpsilon(): number {
    return this.currentEpsilon;
  }
}
