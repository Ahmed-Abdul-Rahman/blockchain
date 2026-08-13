import { describe, expect, it } from 'vitest';
import {
  exportIdentitySeed,
  generateIdentitySeed,
  parseIdentitySeed,
  peerIdFromIdentitySeed,
} from '../../src/identity/identitySeed';

describe('identity seed', () => {
  it('generates a high-entropy seed that round-trips through parse and export', () => {
    const seed = generateIdentitySeed();
    expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseIdentitySeed(`  ${seed}  `)).toBe(seed);
    expect(exportIdentitySeed(seed)).toBe(seed);
  });

  it('rejects empty or oversized seeds', () => {
    expect(() => parseIdentitySeed('')).toThrow(/empty/);
    expect(() => parseIdentitySeed('   ')).toThrow(/empty/);
    expect(() => parseIdentitySeed('x'.repeat(513))).toThrow(/too long/);
  });

  it('derives a stable PeerId from a seed', async () => {
    const seed = 'portable-identity-seed';
    const first = await peerIdFromIdentitySeed(` ${seed} `);
    const second = await peerIdFromIdentitySeed(seed);
    const other = await peerIdFromIdentitySeed('other-identity-seed');

    expect(first).toBe(second);
    expect(first.startsWith('12D3KooW')).toBe(true);
    expect(other).not.toBe(first);
  });
});
