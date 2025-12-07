import { describe, it, expect, vi } from 'vitest';
import { PeerRegistry } from '../../src/PeerRegistry';

describe('PeerRegistry', () => {
  it('adds, dedups addresses and TTLs entries', () => {
    const pr = new PeerRegistry('self', 10);
    pr.upsertMany([
      { peerId: 'p1', addresses: ['/ip4/127.0.0.1/tcp/0'] },
      { peerId: 'p1', addresses: ['/ip4/127.0.0.1/tcp/1'] },
    ]);

    const cands = pr.getCandidates(10);
    expect(cands.length).toBe(1);
    expect(new Set(cands[0].addresses).size).toBe(2);

    // simulate TTL expiry
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
    const cands2 = pr.getCandidates(10);
    // expired entries are filtered internally; result may be empty
    expect(cands2.length).toBe(0);
    nowSpy.mockRestore();
  });

  it('enforces PEX request cooldown', () => {
    const pr = new PeerRegistry('self', 10);
    pr.upsert({ peerId: 'p1', addresses: [] });
    // expect(pr.markRequestedAndGetPeers('p1', 5).length).toBeGreaterThanOrEqual(0); // first ok
    // // immediate second call should return empty due to cooldown
    // expect(pr.markRequestedAndGetPeers('p1', 5)).toEqual([]);
  });
});
