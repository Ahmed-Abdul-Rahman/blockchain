/**
 * Fixed-size circular buffer for sliding-window metrics.
 * Oldest entries are overwritten once capacity is reached.
 */
export class SlidingWindowRingBuffer<T> {
  private readonly buffer: T[];
  private writeIndex = 0;
  private count = 0;

  /**
   * @param capacity Maximum number of entries retained in the window
   */
  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('SlidingWindowRingBuffer capacity must be positive');
    }
    this.buffer = new Array<T>(capacity);
  }

  /** Number of entries currently stored (at most capacity) */
  get length(): number {
    return this.count;
  }

  /** Append a value, evicting the oldest entry when at capacity */
  push(value: T): void {
    this.buffer[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Return entries in chronological order (oldest first) */
  toArray(): readonly T[] {
    if (this.count === 0) {
      return [];
    }
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count);
    }
    return [...this.buffer.slice(this.writeIndex), ...this.buffer.slice(0, this.writeIndex)];
  }

  /** Remove all entries from the window */
  clear(): void {
    this.writeIndex = 0;
    this.count = 0;
  }
}
