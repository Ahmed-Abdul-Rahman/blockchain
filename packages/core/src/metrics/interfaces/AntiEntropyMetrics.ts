import { SyncAttemptRecord, SyncSkipReason } from '../../data-convergence/scheduling/types';

/** Event-sink interface for anti-entropy sync telemetry (fire-and-forget hooks) */
export interface AntiEntropyMetrics {
  /** Metrics namespace identifier */
  readonly namespace: 'anti_entropy';

  /** Fired when a scheduled sync tick begins evaluation */
  scheduledTickStarted(): void;

  /** Fired when a scheduled tick is skipped without running outbound sync */
  scheduledTickSkipped(reason: SyncSkipReason): void;

  /** Fired when an outbound sync attempt starts against a peer */
  outboundSyncStarted(peerId: string): void;

  /** Fired when an outbound sync attempt completes */
  outboundSyncCompleted(record: SyncAttemptRecord): void;

  /** Fired when inbound bidirectional sync discovers missing hashes */
  inboundSyncDiscoveredHashes(peerId: string, count: number): void;

  /** Fired when a per-hash data fetch begins */
  fetchHashStarted(peerId: string, hash: string): void;

  /** Fired when a per-hash data fetch completes */
  fetchHashCompleted(peerId: string, hash: string, durationMs: number, success: boolean): void;
}

export type { SyncSkipReason };
