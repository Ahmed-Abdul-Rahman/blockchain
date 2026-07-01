import { PeerId } from '@libp2p/interface';
import { DeChatConfig } from '../../config/types';
import { clamp, computeUrgency, equalJitter, lerp, weightedRandomPick } from './math';
import { PeerConvergenceTracker } from './PeerConvergenceTracker';
import { SyncAttemptRecord, SyncScheduler, SyncTickContext } from './types';

type AdaptiveConfig = DeChatConfig['strategies']['synchronizer']['adaptive'];

/**
 * ADR Phase 1–2 scheduler: weighted peer pick, idle skip, and urgency-based interval.
 */
export class HeuristicSyncScheduler implements SyncScheduler {
  /**
   * @param config Adaptive synchronizer config
   * @param peerTracker Per-peer convergence scores for weighted selection
   */
  constructor(
    private readonly config: AdaptiveConfig,
    private readonly peerTracker: PeerConvergenceTracker,
  ) {}

  pickPeer(candidates: readonly PeerId[]): PeerId {
    const minWeight = this.config.minPeerWeight;
    return weightedRandomPick(candidates, (peer) => Math.max(minWeight, this.peerTracker.getScore(peer.toString())));
  }

  shouldSkipTick(ctx: SyncTickContext): boolean {
    // Floor sync must never be skipped — ensures eventual consistency ceiling
    if (ctx.forceFloorSync) {
      return false;
    }

    // Require K consecutive zero-hash completes before considering idle skip
    if (ctx.consecutiveZeroHashComplete < this.config.idleSkipStreak) {
      return false;
    }

    // Active replication (state vector index 5) means the room is not dormant
    const replicationActivityRate = ctx.stateVector[5];
    if (replicationActivityRate >= this.config.idleActivityThreshold) {
      return false;
    }

    return true;
  }

  nextIntervalMs(ctx: SyncTickContext): number {
    const urgency = computeUrgency(ctx.stateVector);
    const base = lerp(this.config.maxIntervalMs, this.config.minIntervalMs, urgency);
    const clamped = clamp(base, this.config.minIntervalMs, this.config.maxIntervalMs);
    return clamped + equalJitter(this.config.jitterMs);
  }

  onOutboundSyncComplete(_record: SyncAttemptRecord): void {}
}
