import { SyncAttemptRecord, SyncSkipReason } from '../../data-convergence/scheduling/types';
import { AntiEntropyMetrics } from '../interfaces/AntiEntropyMetrics';
import { BaseMetrics } from './BaseMetrics';

/**
 * Counter/gauge export for anti-entropy events.
 * Scheduler state lives in AntiEntropyMetricsStore (owned by AntiEntropyManager).
 */
export class BasicAntiEntropyMetrics extends BaseMetrics implements AntiEntropyMetrics {
  readonly namespace = 'anti_entropy' as const;

  scheduledTickStarted(): void {
    this.inc('scheduled_tick_started');
  }

  scheduledTickSkipped(reason: SyncSkipReason): void {
    this.inc('scheduled_tick_skipped');
    this.inc(`scheduled_tick_skipped:${reason}`);
  }

  outboundSyncStarted(peerId: string): void {
    this.inc('outbound_sync_started');
    this.inc(`outbound_sync_started:${peerId}`);
  }

  outboundSyncCompleted(record: SyncAttemptRecord): void {
    this.inc('outbound_sync_completed');
    this.inc(`outbound_sync_result:${record.result.kind}`);
  }

  inboundSyncDiscoveredHashes(peerId: string, count: number): void {
    this.inc('inbound_sync_hashes_discovered', count);
    this.inc(`inbound_sync_hashes_discovered:${peerId}`, count);
  }

  fetchHashStarted(_peerId: string, _hash: string): void {
    this.inc('fetch_hash_started');
  }

  fetchHashCompleted(_peerId: string, _hash: string, durationMs: number, success: boolean): void {
    this.inc(success ? 'fetch_hash_succeeded' : 'fetch_hash_failed');
    this.setGauge('last_fetch_hash_duration_ms', durationMs);
  }
}
