import { describe, expect, it } from 'vitest';
import { BasicAntiEntropyMetrics } from '../../../src/metrics/basic/BasicAntiEntropyMetrics';

describe('BasicAntiEntropyMetrics', () => {
  it('increments counters on scheduled tick events', () => {
    const metrics = new BasicAntiEntropyMetrics();
    metrics.scheduledTickStarted();
    metrics.scheduledTickSkipped('idle_skip');

    const snap = metrics.snapshot();
    expect(snap.counters.scheduled_tick_started).toBe(1);
    expect(snap.counters.scheduled_tick_skipped).toBe(1);
    expect(snap.counters['scheduled_tick_skipped:idle_skip']).toBe(1);
  });

  it('records outbound sync result counters', () => {
    const metrics = new BasicAntiEntropyMetrics();
    metrics.outboundSyncCompleted({
      peerId: 'peer-1',
      startedAt: Date.now(),
      durationMs: 100,
      result: { kind: 'complete', hashesDiscovered: 3, durationMs: 100 },
    });

    const snap = metrics.snapshot();
    expect(snap.counters.outbound_sync_completed).toBe(1);
    expect(snap.counters['outbound_sync_result:complete']).toBe(1);
  });

  it('records fetch hash gauges', () => {
    const metrics = new BasicAntiEntropyMetrics();
    metrics.fetchHashCompleted('peer-1', 'hash', 42, true);

    const snap = metrics.snapshot();
    expect(snap.counters.fetch_hash_succeeded).toBe(1);
    expect(snap.gauges.last_fetch_hash_duration_ms).toBe(42);
  });
});
