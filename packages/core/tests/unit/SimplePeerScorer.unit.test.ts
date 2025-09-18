import { describe, it, expect } from 'vitest';
import { SimplePeerScorer } from '../../src/SimplePeerScorer';

describe('SimplePeerScorer', () => {
  it('rewards and penalizes; dialable threshold works', () => {
    const s = new SimplePeerScorer(-10, 100, -2, 1.0);
    const pid = 'peerA';
    expect(s.isDialable(pid)).toBe(true); // default 0 >= -2

    s.penalize(pid, 5);
    expect(s.get(pid)).toBe(-5);
    expect(s.isDialable(pid)).toBe(false);

    s.reward(pid, 10);
    expect(s.get(pid)).toBe(5);
    expect(s.isDialable(pid)).toBe(true);
  });

  it('decays scores over time', () => {
    const s = new SimplePeerScorer(-10, 100, -2, 0.5);
    const pid = 'peerB';
    s.reward(pid, 64);
    s.decay();
    expect(s.get(pid)).toBeCloseTo(32);
    s.decay();
    expect(s.get(pid)).toBeCloseTo(16);
  });

  it('inbound acceptance threshold independent of dialable', () => {
    const s = new SimplePeerScorer(-10, 100, -2, 1.0);
    const pid = 'peerC';
    s.penalize(pid, 4);
    expect(s.isDialable(pid)).toBe(false); // -4 < -2
    expect(s.isAcceptingInbound(pid)).toBe(true); // -4 >= -5
    s.penalize(pid, 2);
    expect(s.isAcceptingInbound(pid)).toBe(false); // -6 < -5
  });
});
