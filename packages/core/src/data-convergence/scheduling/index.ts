import { DeChatConfig } from '../../config/types';
import { AntiEntropyMetricsStore } from './AntiEntropyMetricsStore';
import { BanditSyncScheduler } from './bandit/BanditSyncScheduler';
import { FixedSyncScheduler } from './FixedSyncScheduler';
import { HeuristicSyncScheduler } from './HeuristicSyncScheduler';
import { SyncScheduler } from './types';

/**
 * Resolves effective maxIntervalMs: explicit adaptive.maxIntervalMs or legacy syncIntervalMs.
 */
const resolveMaxIntervalMs = (config: DeChatConfig['strategies']['synchronizer']): number =>
  config.adaptive.maxIntervalMs ?? config.syncIntervalMs;

/**
 * Factory for pluggable sync schedulers based on synchronizer config.
 */
export const createSyncScheduler = (
  config: DeChatConfig['strategies']['synchronizer'],
  metricsStore: AntiEntropyMetricsStore,
): SyncScheduler => {
  const adaptive = config.adaptive;

  if (!adaptive.enabled || adaptive.scheduler === 'fixed') {
    return new FixedSyncScheduler(config.syncIntervalMs);
  }

  if (adaptive.scheduler === 'heuristic') {
    return new HeuristicSyncScheduler(
      { ...adaptive, maxIntervalMs: resolveMaxIntervalMs(config) },
      metricsStore.getPeerConvergenceTracker(),
    );
  }

  return new BanditSyncScheduler({ ...adaptive, maxIntervalMs: resolveMaxIntervalMs(config) }, metricsStore);
};

export { AntiEntropyMetricsStore, createAntiEntropyMetricsStore } from './AntiEntropyMetricsStore';
export { BanditSyncScheduler } from './bandit/BanditSyncScheduler';
export { DynamicArmSet } from './bandit/DynamicArmSet';
export { EpsilonGreedyPolicy } from './bandit/EpsilonGreedyPolicy';
export { computeSyncReward } from './bandit/RewardFunction';
export { FixedSyncScheduler } from './FixedSyncScheduler';
export { HeuristicSyncScheduler } from './HeuristicSyncScheduler';
export { PeerConvergenceTracker } from './PeerConvergenceTracker';
export { ReplicationActivityTracker } from './ReplicationActivityTracker';
export { SlidingWindowRingBuffer } from './SlidingWindowRingBuffer';
export { StateVectorBuilder } from './StateVectorBuilder';
export * from './types';
