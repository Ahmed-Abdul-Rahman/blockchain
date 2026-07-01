import { SyncAttemptRecord, SyncSkipReason } from '../../data-convergence/scheduling/types';
import { AntiEntropyMetrics } from '../interfaces/AntiEntropyMetrics';

/** No-op anti-entropy metrics for when metrics export is disabled */
export class NoopAntiEntropyMetrics implements AntiEntropyMetrics {
  readonly namespace = 'anti_entropy' as const;

  scheduledTickStarted(): void {}
  scheduledTickSkipped(_reason: SyncSkipReason): void {}
  outboundSyncStarted(_peerId: string): void {}
  outboundSyncCompleted(_record: SyncAttemptRecord): void {}
  inboundSyncDiscoveredHashes(_peerId: string, _count: number): void {}
  fetchHashStarted(_peerId: string, _hash: string): void {}
  fetchHashCompleted(_peerId: string, _hash: string, _durationMs: number, _success: boolean): void {}
}
