import { PeerId } from '@libp2p/interface';
import { DeChatConfig } from '../../../config/types';
import { AntiEntropyMetricsStore } from '../AntiEntropyMetricsStore';
import { HeuristicSyncScheduler } from '../HeuristicSyncScheduler';
import { SyncAttemptRecord, SyncScheduler, SyncTickContext } from '../types';
import { DynamicArmSet } from './DynamicArmSet';
import { EpsilonGreedyPolicy } from './EpsilonGreedyPolicy';
import { computeSyncReward } from './RewardFunction';

type AdaptiveConfig = DeChatConfig['strategies']['synchronizer']['adaptive'];

const resolveBanditConfig = (
  config: AdaptiveConfig,
): {
  readonly epsilon: number;
  readonly epsilonDecayPerAttempts: number;
  readonly epsilonFloor: number;
} => ({
  epsilon: config.bandit?.epsilon ?? 0.2,
  epsilonDecayPerAttempts: config.bandit?.epsilonDecayPerAttempts ?? 0,
  epsilonFloor: config.bandit?.epsilonFloor ?? 0.05,
});

/**
 * ADR Phase 3 scheduler: epsilon-greedy MAB peer pick with heuristic interval + idle skip.
 */
export class BanditSyncScheduler implements SyncScheduler {
  private readonly heuristic: HeuristicSyncScheduler;
  private readonly armSet: DynamicArmSet;
  private readonly policy: EpsilonGreedyPolicy;

  constructor(config: AdaptiveConfig, metricsStore: AntiEntropyMetricsStore, policy?: EpsilonGreedyPolicy) {
    this.heuristic = new HeuristicSyncScheduler(config, metricsStore.getPeerConvergenceTracker());
    this.armSet = new DynamicArmSet(config.minPeerWeight);
    this.policy = policy ?? new EpsilonGreedyPolicy(resolveBanditConfig(config));
  }

  pickPeer(candidates: readonly PeerId[]): PeerId {
    const peerIds = candidates.map((peer) => peer.toString());
    this.armSet.syncCandidates(peerIds);
    const selectedId = this.policy.selectPeer(peerIds, this.armSet);
    const selected = candidates.find((peer) => peer.toString() === selectedId);
    if (!selected) {
      throw new Error(`BanditSyncScheduler.pickPeer: selected peer ${selectedId} not in candidates`);
    }
    return selected;
  }

  shouldSkipTick(ctx: SyncTickContext): boolean {
    return this.heuristic.shouldSkipTick(ctx);
  }

  nextIntervalMs(ctx: SyncTickContext): number {
    return this.heuristic.nextIntervalMs(ctx);
  }

  onOutboundSyncComplete(record: SyncAttemptRecord): void {
    this.armSet.recordReward(record.peerId, computeSyncReward(record));
    this.policy.onAttemptComplete();
    this.heuristic.onOutboundSyncComplete(record);
  }

  /** Exposed for tests */
  getArmSnapshot(): ReturnType<DynamicArmSet['snapshot']> {
    return this.armSet.snapshot();
  }

  /** Exposed for tests */
  getEpsilon(): number {
    return this.policy.getEpsilon();
  }
}
