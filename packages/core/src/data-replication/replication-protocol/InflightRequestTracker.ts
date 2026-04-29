import { EventEmitter } from 'events';
import { ContentHash } from '../types';

export interface InflightOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
}

export class InflightRequestTracker extends EventEmitter {
  private readonly inflight = new Map<ContentHash, number>();

  public readonly isInflight = (hash: ContentHash): boolean => this.inflight.has(hash);

  public readonly acquire = (hash: ContentHash): void => {
    this.inflight.set(hash, Date.now());
    this.emit('acquired', hash);
  };

  public readonly release = (hash: ContentHash): void => {
    this.inflight.delete(hash);
    this.emit('released', hash);
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
