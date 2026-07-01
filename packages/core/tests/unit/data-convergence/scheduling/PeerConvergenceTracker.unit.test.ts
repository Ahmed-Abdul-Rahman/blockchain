import { describe, expect, it } from 'vitest';
import { PeerConvergenceTracker } from '../../../../src/data-convergence/scheduling/PeerConvergenceTracker';

const defaultConfig = {
  alpha: 0.15,
  beta: 0.05,
  gamma: 0.1,
  idleDecayMs: 30 * 60_000,
  neutralScore: 0.5,
};

describe('PeerConvergenceTracker', () => {
  it('starts unknown peers at neutral score', () => {
    const tracker = new PeerConvergenceTracker(defaultConfig);
    expect(tracker.getScore('peer-a')).toBe(0.5);
  });

  it('boosts score on useful sync proportional to hashes discovered', () => {
    const tracker = new PeerConvergenceTracker(defaultConfig);
    tracker.onUsefulSync('peer-a', 10);
    expect(tracker.getScore('peer-a')).toBeCloseTo(0.65, 2);
  });

  it('decays score on useless sync (complete, zero hashes)', () => {
    const tracker = new PeerConvergenceTracker(defaultConfig);
    tracker.onUsefulSync('peer-a', 5);
    tracker.onUselessSync('peer-a');
    expect(tracker.getScore('peer-a')).toBeLessThan(0.65);
  });

  it('decays score on failed sync', () => {
    const tracker = new PeerConvergenceTracker(defaultConfig);
    tracker.onUsefulSync('peer-a', 10);
    tracker.onFailedSync('peer-a');
    expect(tracker.getScore('peer-a')).toBeCloseTo(0.55, 2);
  });

  it('decays idle peers toward neutral score', () => {
    const tracker = new PeerConvergenceTracker(defaultConfig);
    tracker.onUsefulSync('peer-a', 10);
    const boosted = tracker.getScore('peer-a');

    const farFuture = Date.now() + defaultConfig.idleDecayMs + 1;
    tracker.decayIdlePeers(farFuture);
    const afterDecay = tracker.getScore('peer-a');
    expect(afterDecay).toBeLessThan(boosted);
    expect(afterDecay).toBeGreaterThan(defaultConfig.neutralScore);
  });

  it('snapshot returns all peer scores', () => {
    const tracker = new PeerConvergenceTracker(defaultConfig);
    tracker.onUsefulSync('peer-a', 1);
    tracker.onUselessSync('peer-b');
    const snap = tracker.snapshot();
    expect(snap.has('peer-a')).toBe(true);
    expect(snap.has('peer-b')).toBe(true);
  });
});
