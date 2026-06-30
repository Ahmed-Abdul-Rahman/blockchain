import { PeerId } from '@libp2p/interface';
import { SyncIncompleteReason } from '../types';

/** Reason a scheduled anti-entropy tick was skipped without running an outbound sync */
export type SyncSkipReason = 'mutex' | 'no_peers' | 'idle_skip' | 'floor_sync_forced';

/** Outcome of a single outbound sync attempt (may include intra-attempt retries) */
export type SyncAttemptResult =
  | { readonly kind: 'complete'; readonly hashesDiscovered: number; readonly durationMs: number }
  | {
      readonly kind: 'partial';
      readonly hashesDiscovered: number;
      readonly durationMs: number;
      readonly reason: SyncIncompleteReason;
    }
  | { readonly kind: 'failed'; readonly durationMs: number };

/** Immutable record of one outbound sync attempt for metrics and scheduler feedback */
export interface SyncAttemptRecord {
  /** String form of the peer dialed for this attempt */
  readonly peerId: string;

  /** Epoch ms when the attempt started */
  readonly startedAt: number;

  /** Wall-clock duration of the attempt in ms */
  readonly durationMs: number;

  /** Discriminated outcome of the attempt */
  readonly result: SyncAttemptResult;
}

/** Snapshot of node state passed to scheduler policy methods on each tick */
export interface SyncTickContext {
  /** Current epoch ms */
  readonly now: number;

  /** Ms elapsed since the last completed outbound sync */
  readonly timeSinceLastSyncMs: number;

  /** Ms elapsed since the last outbound sync that discovered hashes */
  readonly timeSinceLastUsefulSyncMs: number;

  /** Count of consecutive complete syncs with zero hashes discovered */
  readonly consecutiveZeroHashComplete: number;

  /** Normalized state vector (length 7, values in [0, 1]) for policy heuristics */
  readonly stateVector: readonly number[];

  /** When true, idle skip is overridden to enforce the maxIntervalMs floor sync */
  readonly forceFloorSync: boolean;
}

/** Stable index names for the 7-element state vector (ADR-0003 indices 0–6) */
export const STATE_VECTOR_NAMES = [
  'syncSuccessRate',
  'syncTimeoutRate',
  'meanSyncDuration',
  'timeSinceLastSync',
  'timeSinceLastUsefulSync',
  'replicationActivityRate',
  'meanHashesPerSync',
] as const;

/** Fixed-length normalized state vector for scheduler and future ML policies */
export type StateVector = readonly [number, number, number, number, number, number, number];

/**
 * Pluggable outbound sync policy. Controls when and with whom to sync;
 * must not affect data-plane accept/reject logic.
 */
export interface SyncScheduler {
  /** Pick one connected peer for outbound sync */
  pickPeer(candidates: readonly PeerId[]): PeerId;

  /** Whether to skip this scheduled tick (idle skip); floor sync overrides in manager */
  shouldSkipTick(ctx: SyncTickContext): boolean;

  /** Delay in ms until the next scheduled outbound sync attempt */
  nextIntervalMs(ctx: SyncTickContext): number;

  /** Called after each outbound attempt so the policy can update internal state */
  onOutboundSyncComplete(record: SyncAttemptRecord): void;
}
