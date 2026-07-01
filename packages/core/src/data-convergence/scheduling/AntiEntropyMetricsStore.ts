import { DeChatConfig } from '../../config/types';
import { SyncIncompleteReason } from '../types';
import { PeerConvergenceTracker } from './PeerConvergenceTracker';
import { ReplicationActivityTracker } from './ReplicationActivityTracker';
import { SlidingWindowRingBuffer } from './SlidingWindowRingBuffer';
import { StateVectorBuilder } from './StateVectorBuilder';
import { StateVector, SyncAttemptRecord, SyncSkipReason } from './types';

/** Point-in-time snapshot of anti-entropy metrics for tests and interop reporting */
export interface AntiEntropyMetricsSnapshot {
  /** Total outbound sync attempts recorded */
  readonly outboundAttempts: number;

  /** Outbound syncs where hashesDiscovered > 0 */
  readonly usefulSyncs: number;

  /** Hash count from the most recent outbound sync */
  readonly lastSyncHashes: number;

  /** Current consecutive zero-hash complete streak */
  readonly consecutiveZeroHashComplete: number;

  /** Skip counts by reason */
  readonly skipCounts: Readonly<Record<SyncSkipReason, number>>;

  /** Latest 7-element state vector */
  readonly stateVector: StateVector;
}

/**
 * In-memory store for anti-entropy sync telemetry and scheduler query state.
 * Always instantiated regardless of metrics.enabled; export is gated separately.
 */
export class AntiEntropyMetricsStore {
  private readonly outcomeBuffer: SlidingWindowRingBuffer<boolean>;
  private readonly durationBuffer: SlidingWindowRingBuffer<number>;
  private readonly hashesBuffer: SlidingWindowRingBuffer<number>;
  private readonly incompleteReasonCounts = new Map<SyncIncompleteReason, number>();
  private readonly skipCounts = new Map<SyncSkipReason, number>();

  private readonly peerTracker: PeerConvergenceTracker;
  private readonly activityTracker: ReplicationActivityTracker;
  private readonly stateVectorBuilder: StateVectorBuilder;
  private readonly maxIntervalMs: number;

  private readonly windowSize: number;

  /** Epoch ms of the last completed outbound sync; null if none yet */
  private lastCompletedOutboundSyncAt: number | null = null;

  /** Epoch ms of the last outbound sync that discovered hashes; null if none yet */
  private lastUsefulSyncAt: number | null = null;

  /** Consecutive complete syncs with zero hashes discovered */
  private consecutiveZeroHashComplete = 0;

  /** Total outbound attempts (including failed) */
  private outboundAttemptCount = 0;

  /** Total useful syncs (hashes > 0) */
  private usefulSyncCount = 0;

  /** Hashes from the most recent outbound sync */
  private lastSyncHashCount = 0;

  /**
   * @param synchronizerConfig Full synchronizer strategy config
   */
  constructor(synchronizerConfig: DeChatConfig['strategies']['synchronizer']) {
    const adaptive = synchronizerConfig.adaptive;
    const windowSize = adaptive.convergenceWindowSize;
    this.windowSize = windowSize;

    this.maxIntervalMs = adaptive.maxIntervalMs ?? synchronizerConfig.syncIntervalMs;
    this.outcomeBuffer = new SlidingWindowRingBuffer<boolean>(windowSize);
    this.durationBuffer = new SlidingWindowRingBuffer<number>(windowSize);
    this.hashesBuffer = new SlidingWindowRingBuffer<number>(windowSize);
    this.peerTracker = new PeerConvergenceTracker(adaptive.peerConvergence);
    this.activityTracker = new ReplicationActivityTracker();
    this.stateVectorBuilder = new StateVectorBuilder(this, this.maxIntervalMs);
  }

  /** Configured sliding window size */
  getWindowSize(): number {
    return this.windowSize;
  }

  /** Raw outcome booleans from the sliding window */
  getSyncAttemptOutcomes(): readonly boolean[] {
    return this.outcomeBuffer.toArray();
  }

  /** Raw durations from the sliding window */
  getSyncAttemptDurations(): readonly number[] {
    return this.durationBuffer.toArray();
  }

  /** Raw hash counts from the sliding window */
  getSyncHashesDiscovered(): readonly number[] {
    return this.hashesBuffer.toArray();
  }

  /** Rolling counts of incomplete sync reasons */
  getIncompleteReasonCounts(): ReadonlyMap<SyncIncompleteReason, number> {
    return this.incompleteReasonCounts;
  }

  /** Per-peer convergence tracker for weighted peer pick */
  getPeerConvergenceTracker(): PeerConvergenceTracker {
    return this.peerTracker;
  }

  /** Replication activity tracker for state vector index 5 */
  getActivityTracker(): ReplicationActivityTracker {
    return this.activityTracker;
  }

  /** Build normalized state vector at the given time */
  getStateVector(now: number): StateVector {
    return this.stateVectorBuilder.build(now);
  }

  /** Ms since last completed outbound sync; returns maxIntervalMs if never synced */
  getTimeSinceLastSyncMs(now: number): number {
    if (this.lastCompletedOutboundSyncAt === null) {
      return this.maxIntervalMs;
    }
    return now - this.lastCompletedOutboundSyncAt;
  }

  /** Ms since last useful sync; returns maxIntervalMs if never useful */
  getTimeSinceLastUsefulSyncMs(now: number): number {
    if (this.lastUsefulSyncAt === null) {
      return this.maxIntervalMs;
    }
    return now - this.lastUsefulSyncAt;
  }

  /** Current consecutive zero-hash complete streak */
  getConsecutiveZeroHashComplete(): number {
    return this.consecutiveZeroHashComplete;
  }

  /** Record that a scheduled tick started (counter only) */
  recordScheduledTickStarted(): void {
    // Reserved for future tick-rate metrics; no state mutation yet.
  }

  /** Record a skipped scheduled tick with reason */
  recordSkip(reason: SyncSkipReason): void {
    this.skipCounts.set(reason, (this.skipCounts.get(reason) ?? 0) + 1);
  }

  /** Record hashes discovered during an inbound bidirectional sync */
  recordInboundHashes(_peerId: string, count: number): void {
    if (count > 0) {
      this.activityTracker.recordRemoteReceive();
    }
  }

  /** Record start of a per-hash fetch (reserved for future bandwidth metrics) */
  recordFetchHashStarted(_peerId: string, _hash: string): void {}

  /** Record completion of a per-hash fetch (reserved for future bandwidth metrics) */
  recordFetchHashCompleted(_peerId: string, _hash: string, _durationMs: number, _success: boolean): void {}

  /** Record a completed outbound sync attempt and update all derived state */
  recordOutboundAttempt(record: SyncAttemptRecord): void {
    const now = Date.now();
    this.outboundAttemptCount++;
    this.lastSyncHashCount = this.extractHashCount(record);
    this.durationBuffer.push(record.durationMs);
    this.hashesBuffer.push(this.lastSyncHashCount);

    const { result } = record;

    if (result.kind === 'complete') {
      this.outcomeBuffer.push(true);
      this.lastCompletedOutboundSyncAt = now;

      if (this.lastSyncHashCount > 0) {
        this.usefulSyncCount++;
        this.lastUsefulSyncAt = now;
        this.consecutiveZeroHashComplete = 0;
        this.peerTracker.onUsefulSync(record.peerId, this.lastSyncHashCount);
      } else {
        this.consecutiveZeroHashComplete++;
        this.peerTracker.onUselessSync(record.peerId);
      }
    } else if (result.kind === 'partial') {
      this.outcomeBuffer.push(false);
      this.lastCompletedOutboundSyncAt = now;
      this.consecutiveZeroHashComplete = 0;
      this.incompleteReasonCounts.set(result.reason, (this.incompleteReasonCounts.get(result.reason) ?? 0) + 1);
      if (this.lastSyncHashCount > 0) {
        this.usefulSyncCount++;
        this.lastUsefulSyncAt = now;
        this.peerTracker.onUsefulSync(record.peerId, this.lastSyncHashCount);
      } else {
        this.peerTracker.onFailedSync(record.peerId);
      }
    } else {
      this.outcomeBuffer.push(false);
      this.lastCompletedOutboundSyncAt = now;
      this.consecutiveZeroHashComplete = 0;
      this.peerTracker.onFailedSync(record.peerId);
    }

    this.peerTracker.decayIdlePeers(now);
  }

  /** Point-in-time snapshot for tests and interop workers */
  snapshot(now: number = Date.now()): AntiEntropyMetricsSnapshot {
    const skipRecord: Record<SyncSkipReason, number> = {
      mutex: this.skipCounts.get('mutex') ?? 0,
      no_peers: this.skipCounts.get('no_peers') ?? 0,
      idle_skip: this.skipCounts.get('idle_skip') ?? 0,
      floor_sync_forced: this.skipCounts.get('floor_sync_forced') ?? 0,
    };

    return {
      outboundAttempts: this.outboundAttemptCount,
      usefulSyncs: this.usefulSyncCount,
      lastSyncHashes: this.lastSyncHashCount,
      consecutiveZeroHashComplete: this.consecutiveZeroHashComplete,
      skipCounts: skipRecord,
      stateVector: this.getStateVector(now),
    };
  }

  private extractHashCount(record: SyncAttemptRecord): number {
    const { result } = record;
    if (result.kind === 'failed') {
      return 0;
    }
    return result.hashesDiscovered;
  }
}

/** Factory for AntiEntropyMetricsStore */
export const createAntiEntropyMetricsStore = (
  synchronizerConfig: DeChatConfig['strategies']['synchronizer'],
): AntiEntropyMetricsStore => new AntiEntropyMetricsStore(synchronizerConfig);
