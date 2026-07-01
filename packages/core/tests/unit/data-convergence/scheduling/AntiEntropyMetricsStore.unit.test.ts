import { describe, expect, it } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../../src/config/defaults';
import { AntiEntropyMetricsStore } from '../../../../src/data-convergence/scheduling/AntiEntropyMetricsStore';

describe('AntiEntropyMetricsStore', () => {
  it('increments scheduledTicks on each recordScheduledTickStarted call', () => {
    const store = new AntiEntropyMetricsStore(DECHAT_DEFAULTS.strategies.synchronizer);

    store.recordScheduledTickStarted();
    store.recordScheduledTickStarted();
    store.recordSkip('idle_skip');
    store.recordScheduledTickStarted();

    const snap = store.snapshot();
    expect(snap.scheduledTicks).toBe(3);
    expect(snap.skipCounts.idle_skip).toBe(1);
  });
});
