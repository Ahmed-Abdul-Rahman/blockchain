import { pickRandom } from '@dechat/common';
import { PeerId } from '@libp2p/interface';
import { SyncAttemptRecord, SyncScheduler, SyncTickContext } from './types';

/**
 * Baseline scheduler preserving legacy behaviour: uniform random peer pick,
 * fixed interval, never skip ticks.
 */
export class FixedSyncScheduler implements SyncScheduler {
  /**
   * @param syncIntervalMs Fixed delay between scheduled sync attempts
   * @param pickRandomFn Random selection helper (injectable for tests)
   */
  constructor(
    private readonly syncIntervalMs: number,
    private readonly pickRandomFn: typeof pickRandom = pickRandom,
  ) {}

  pickPeer(candidates: readonly PeerId[]): PeerId {
    return this.pickRandomFn([...candidates]).item;
  }

  shouldSkipTick(_ctx: SyncTickContext): boolean {
    return false;
  }

  nextIntervalMs(_ctx: SyncTickContext): number {
    return this.syncIntervalMs;
  }

  onOutboundSyncComplete(_record: SyncAttemptRecord): void {}
}
