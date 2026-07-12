type ArmStats = {
  pulls: number;
  totalReward: number;
};

/**
 * Per-peer bandit arms with churn-safe pruning.
 * New peers start with optimistic prior reward = minPeerWeight so they stay reachable.
 */
export class DynamicArmSet {
  private readonly arms = new Map<string, ArmStats>();

  constructor(private readonly minPeerWeight: number) {}

  /** Drop arms for disconnected peers; ensure every candidate has an arm */
  syncCandidates(candidatePeerIds: readonly string[]): void {
    const active = new Set(candidatePeerIds);

    for (const peerId of this.arms.keys()) {
      if (!active.has(peerId)) {
        this.arms.delete(peerId);
      }
    }

    for (const peerId of candidatePeerIds) {
      if (!this.arms.has(peerId)) {
        this.arms.set(peerId, { pulls: 0, totalReward: 0 });
      }
    }
  }

  /** Average reward for an arm; unexplored arms return optimistic minPeerWeight */
  getAverageReward(peerId: string): number {
    const arm = this.arms.get(peerId);
    if (!arm || arm.pulls === 0) {
      return this.minPeerWeight;
    }
    return arm.totalReward / arm.pulls;
  }

  recordReward(peerId: string, reward: number): void {
    const arm = this.arms.get(peerId);
    if (!arm) {
      return;
    }
    arm.pulls++;
    arm.totalReward += reward;
  }

  /** Snapshot for tests and debug */
  snapshot(): ReadonlyMap<string, { readonly pulls: number; readonly averageReward: number }> {
    const result = new Map<string, { pulls: number; averageReward: number }>();
    for (const [peerId, arm] of this.arms) {
      result.set(peerId, {
        pulls: arm.pulls,
        averageReward: arm.pulls === 0 ? this.minPeerWeight : arm.totalReward / arm.pulls,
      });
    }
    return result;
  }
}
