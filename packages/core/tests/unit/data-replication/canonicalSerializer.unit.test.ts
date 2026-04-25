/** biome-ignore-all lint/suspicious/noExplicitAny: <As it is going to test with random objects> */
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '../../../src/data-replication/serializers';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('canonicalSerialize', () => {
  // -----------------------------
  // Basic primitives
  // -----------------------------
  it('should serialize null', () => {
    expect(decode(canonicalSerialize(null))).toBe('null');
  });

  it('should serialize boolean', () => {
    expect(decode(canonicalSerialize(true))).toBe('true');
    expect(decode(canonicalSerialize(false))).toBe('false');
  });

  it('should serialize numbers', () => {
    expect(decode(canonicalSerialize(42))).toBe('42');
    expect(decode(canonicalSerialize(0))).toBe('0');
    expect(decode(canonicalSerialize(-10.5))).toBe('-10.5');
  });

  it('should serialize strings', () => {
    expect(decode(canonicalSerialize('hello'))).toBe('"hello"');
  });

  // -----------------------------
  // Number edge cases
  // -----------------------------
  it('should throw for NaN', () => {
    expect(() => canonicalSerialize(NaN)).toThrow();
  });

  it('should throw for Infinity', () => {
    expect(() => canonicalSerialize(Infinity)).toThrow();
  });

  it('should throw for -Infinity', () => {
    expect(() => canonicalSerialize(-Infinity)).toThrow();
  });

  // -----------------------------
  // Arrays
  // -----------------------------
  it('should serialize arrays preserving order', () => {
    const result = decode(canonicalSerialize([3, 2, 1]));
    expect(result).toBe('[3,2,1]');
  });

  it('should serialize nested arrays', () => {
    const result = decode(canonicalSerialize([1, [2, 3]]));
    expect(result).toBe('[1,[2,3]]');
  });

  // -----------------------------
  // Objects
  // -----------------------------
  it('should sort object keys', () => {
    const input = { b: 1, a: 2 };
    const result = decode(canonicalSerialize(input));

    expect(result).toBe('{"a":2,"b":1}');
  });

  it('should deeply sort nested objects', () => {
    const a = { x: { b: 1, a: 2 } };
    const b = { x: { a: 2, b: 1 } };

    const hashA = decode(canonicalSerialize(a));
    const hashB = decode(canonicalSerialize(b));

    expect(hashA).toBe(hashB);
  });

  it('should handle deeply nested structures', () => {
    const input = {
      z: 1,
      a: {
        d: 4,
        b: {
          y: 2,
          x: 1,
        },
      },
    };

    const result = decode(canonicalSerialize(input));

    expect(result).toBe('{"a":{"b":{"x":1,"y":2},"d":4},"z":1}');
  });

  // -----------------------------
  // Undefined handling
  // -----------------------------
  it('should omit undefined fields', () => {
    const input = {
      a: 1,
      b: undefined,
    };

    const result = decode(canonicalSerialize(input));

    expect(result).toBe('{"a":1}');
  });

  it('should convert undefined in array to null', () => {
    const result = decode(canonicalSerialize([1, undefined]));
    expect(result).toBe('[1,null]');
  });

  // -----------------------------
  // Date handling
  // -----------------------------
  it('should serialize Date to ISO string', () => {
    const date = new Date('2020-01-01T00:00:00.000Z');

    const result = decode(canonicalSerialize(date));

    expect(result).toBe('"2020-01-01T00:00:00.000Z"');
  });

  // -----------------------------
  // Unsupported types
  // -----------------------------
  it('should throw for BigInt', () => {
    expect(() => canonicalSerialize(BigInt(10))).toThrow();
  });

  it('should throw for Map', () => {
    expect(() => canonicalSerialize(new Map())).toThrow();
  });

  it('should throw for Set', () => {
    expect(() => canonicalSerialize(new Set())).toThrow();
  });

  it('should throw for function', () => {
    expect(() => canonicalSerialize(() => {})).toThrow();
  });

  // -----------------------------
  // Circular references
  // -----------------------------
  it('should throw on circular reference', () => {
    const obj: any = {};
    obj.self = obj;

    expect(() => canonicalSerialize(obj)).toThrow();
  });

  // -----------------------------
  // Determinism tests
  // -----------------------------
  it('should produce same output for same semantic object', () => {
    const a = {
      foo: {
        z: 3,
        a: 1,
      },
      bar: [3, 2, 1],
    };

    const b = {
      bar: [3, 2, 1],
      foo: {
        a: 1,
        z: 3,
      },
    };

    const resultA = decode(canonicalSerialize(a));
    const resultB = decode(canonicalSerialize(b));

    expect(resultA).toBe(resultB);
  });

  it('should be stable across multiple runs', () => {
    const input = {
      b: 2,
      a: { y: 2, x: 1 },
    };

    const r1 = decode(canonicalSerialize(input));
    const r2 = decode(canonicalSerialize(input));
    const r3 = decode(canonicalSerialize(input));

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  // -----------------------------
  // Large object test
  // -----------------------------
  it('should handle large objects deterministically', () => {
    const input = Object.fromEntries(
      Array.from({ length: 1000 }).map((_, i) => [`key${i}`, { value: i, nested: { b: 2, a: 1 } }]),
    );

    const result1 = decode(canonicalSerialize(input));
    const result2 = decode(canonicalSerialize(input));

    expect(result1).toBe(result2);
  });
});
