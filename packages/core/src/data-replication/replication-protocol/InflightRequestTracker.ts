import { EventEmitter } from 'events';
import { ContentHash } from '../types';

export interface InflightOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
}

export class InflightRequestTracker extends EventEmitter {
  private readonly inflight = new Set<ContentHash>();

  public readonly isInflight = (hash: ContentHash): boolean => this.inflight.has(hash);

  public readonly acquire = (hash: ContentHash): void => {
    this.inflight.add(hash);
  };

  public readonly release = (hash: ContentHash): void => {
    this.inflight.delete(hash);
  };
}
