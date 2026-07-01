import { describe, expect, it } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../../src/config/defaults';
import { AntiEntropyMetricsStore } from '../../../../src/data-convergence/scheduling/AntiEntropyMetricsStore';
import { StateVectorBuilder } from '../../../../src/data-convergence/scheduling/StateVectorBuilder';

const synchronizerConfig = DECHAT_DEFAULTS.strategies.synchronizer;

describe('StateVectorBuilder', () => {
  it('returns zeroed rates when no sync history exists', () => {
    const store = new AntiEntropyMetricsStore(synchronizerConfig);
    const builder = new StateVectorBuilder(store, synchronizerConfig.adaptive.maxIntervalMs);
    const vector = builder.build(Date.now());

    expect(vector[0]).toBe(0); // syncSuccessRate
    expect(vector[1]).toBe(0); // syncTimeoutRate
    expect(vector[6]).toBe(0); // meanHashesPerSync
  });

  it('clamps time-since gauges to [0, 1]', () => {
    const store = new AntiEntropyMetricsStore(synchronizerConfig);
    const maxInterval = synchronizerConfig.adaptive.maxIntervalMs;
    const builder = new StateVectorBuilder(store, maxInterval);

    store.recordOutboundAttempt({
      peerId: 'peer-1',
      startedAt: Date.now(),
      durationMs: 100,
      result: { kind: 'complete', hashesDiscovered: 0, durationMs: 100 },
    });

    const vector = builder.build(Date.now());
    expect(vector[3]).toBeGreaterThanOrEqual(0);
    expect(vector[3]).toBeLessThanOrEqual(1);
    expect(vector[4]).toBeGreaterThanOrEqual(0);
    expect(vector[4]).toBeLessThanOrEqual(1);
  });

  it('buildForPeer appends peer convergence score as index 7', () => {
    const store = new AntiEntropyMetricsStore(synchronizerConfig);
    const builder = new StateVectorBuilder(store, synchronizerConfig.adaptive.maxIntervalMs);

    store.recordOutboundAttempt({
      peerId: 'peer-1',
      startedAt: Date.now(),
      durationMs: 100,
      result: { kind: 'complete', hashesDiscovered: 5, durationMs: 100 },
    });

    const peerVector = builder.buildForPeer('peer-1', Date.now());
    expect(peerVector).toHaveLength(8);
    expect(peerVector[7]).toBeGreaterThan(0.5);
  });
});
