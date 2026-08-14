import { describe, expect, it } from 'vitest';
import { parseDisplayName } from '../../src/identity/displayName';

describe('parseDisplayName', () => {
  it('trims a valid nickname', () => {
    expect(parseDisplayName('  alice  ')).toBe('alice');
  });

  it('treats empty as cleared', () => {
    expect(parseDisplayName('   ')).toBeUndefined();
    expect(parseDisplayName('')).toBeUndefined();
  });

  it('rejects oversized or control-character names', () => {
    expect(() => parseDisplayName('a'.repeat(65))).toThrow(/too long/);
    expect(() => parseDisplayName('bad\nname')).toThrow(/control/);
  });
});
