import { DeChatConfig } from '../../config/types';
import { AntiEntropyMetricsStore } from './AntiEntropyMetricsStore';
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

  // Bandit scheduler (Phase 3) not yet implemented — fall back to heuristic
  return new HeuristicSyncScheduler(
    { ...adaptive, maxIntervalMs: resolveMaxIntervalMs(config) },
    metricsStore.getPeerConvergenceTracker(),
  );
};

export { AntiEntropyMetricsStore, createAntiEntropyMetricsStore } from './AntiEntropyMetricsStore';
export { FixedSyncScheduler } from './FixedSyncScheduler';
export { HeuristicSyncScheduler } from './HeuristicSyncScheduler';
export { PeerConvergenceTracker } from './PeerConvergenceTracker';
export { ReplicationActivityTracker } from './ReplicationActivityTracker';
export { SlidingWindowRingBuffer } from './SlidingWindowRingBuffer';
export { StateVectorBuilder } from './StateVectorBuilder';
export * from './types';
