import { describe, expect, it } from 'vitest';
import { SlidingWindowRingBuffer } from '../../../../src/data-convergence/scheduling/SlidingWindowRingBuffer';

describe('SlidingWindowRingBuffer', () => {
  it('starts empty with zero length', () => {
    const buffer = new SlidingWindowRingBuffer<number>(3);
    expect(buffer.length).toBe(0);
    expect(buffer.toArray()).toEqual([]);
  });

  it('accumulates entries until capacity is reached', () => {
    const buffer = new SlidingWindowRingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    expect(buffer.length).toBe(2);
    expect(buffer.toArray()).toEqual([1, 2]);
  });

  it('wraps and evicts oldest entries at capacity', () => {
    const buffer = new SlidingWindowRingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);
    expect(buffer.length).toBe(3);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('clear resets the buffer', () => {
    const buffer = new SlidingWindowRingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.toArray()).toEqual([]);
  });

  it('rejects non-positive capacity', () => {
    expect(() => new SlidingWindowRingBuffer<number>(0)).toThrow();
  });
});
