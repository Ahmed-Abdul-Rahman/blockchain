import EventEmitter from 'eventemitter3';
import { ContentHash } from '../types';

export interface InflightOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
}

/**
 * Tracks in-flight content-hash fetches and emits lifecycle events.
 * Uses composition with `eventemitter3` (portable across Node and browser).
 */
export class InflightRequestTracker {
  /** Event bus — listen for `acquired` / `released`. */
  readonly events = new EventEmitter<{
    acquired: [ContentHash];
    released: [ContentHash];
  }>();

  private readonly inflight = new Map<ContentHash, number>();

  public readonly isInflight = (hash: ContentHash): boolean => this.inflight.has(hash);

  public readonly acquire = (hash: ContentHash): void => {
    this.inflight.set(hash, Date.now());
    this.events.emit('acquired', hash);
  };

  public readonly release = (hash: ContentHash): void => {
    this.inflight.delete(hash);
    this.events.emit('released', hash);
  };

  public readonly clearExpired = (ttlMs: number): void => {
    const now = Date.now();
    this.inflight.forEach((timestamp, hash) => {
      if (now - timestamp > ttlMs) {
        this.inflight.delete(hash);
      }
    });
  };
}

export const inflightRequestTracker = (): InflightRequestTracker => new InflightRequestTracker();
