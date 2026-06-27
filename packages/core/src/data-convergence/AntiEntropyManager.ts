import { logger, pickRandom } from '@dechat/common';
import { Libp2p, PeerId, Startable } from '@libp2p/interface';
import { DataReplicationInterface } from '../data-replication/DataReplicationInterface';
import { DeChatComponents, DeChatFactory } from '../types';
import { AntiEntropyNetworkExchange } from './AntiEntropyNetworkExchange';

/**
 * Orchestrates the background Anti-Entropy Data Convergence process.
 * Periodically selects a random peer, computes state differences,
 * and requests missing data to guarantee eventual consistency.
 */
export class AntiEntropyManager implements Startable {
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  /** Active backoff timer between partial-sync retries, tracked so stop() can cancel it. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolver for the in-flight backoff promise, used to unblock the retry loop on stop(). */
  private resolveRetryWait: (() => void) | null = null;

  private readonly node: Libp2p;
  private readonly exchangeEngine: AntiEntropyNetworkExchange;
  private readonly dataReplication: DataReplicationInterface;
  private config: DeChatComponents['config']['strategies']['synchronizer'];

  constructor(components: DeChatComponents) {
    if (!components.strategies?.dataReplication) {
      throw new Error('AntiEntropyManager requires dataReplication strategy to be registered first.');
    }
    if (!components.strategies?.networkExchanger) {
      throw new Error('AntiEntropyManager requires antiEntropyExchange strategy to be registered first.');
    }
    this.node = components.libp2p;
    this.config = components.config.strategies.synchronizer;
    this.exchangeEngine = components.strategies.networkExchanger;
    this.dataReplication = components.strategies.dataReplication;

    // Wire before any Startable.start() so inbound syncs never race an unset callback.
    this.bindMissingHashesListener();
  }

  /**
   * Starts the background synchronization scheduler and binds event listeners.
   */
  public start(): void {
    if (this.syncTimer) {
      logger.warn('[AntiEntropyManager] Sync manager is already running.');
      return;
    }

    this.bindMissingHashesListener();

    // Start the background cron job
    this.syncTimer = setInterval(() => {
      this.performScheduledSync().catch((err) =>
        logger.error(`[AntiEntropyManager] Scheduled sync failed: ${(err as Error).message}`),
      );
    }, this.config.syncIntervalMs);

    logger.info(`[AntiEntropyManager] Started background sync (Interval: ${this.config.syncIntervalMs}ms)`);
  }

  /**
   * Stops the background scheduler and cleans up listeners.
   */
  public stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Cancel any pending retry backoff and release a loop that may be awaiting it,
    // so teardown never leaves a dangling timer (CI hang risk).
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.resolveRetryWait?.();
    this.resolveRetryWait = null;

    this.exchangeEngine.onMissingHashesDiscovered = undefined;
    logger.info('[AntiEntropyManager] Stopped background sync.');
  }

  /**
   * Binds the listener-side callback used when inbound bidirectional syncs discover gaps.
   */
  private bindMissingHashesListener(): void {
    this.exchangeEngine.onMissingHashesDiscovered = (hashes: readonly string[], peerId: PeerId) => {
      this.fetchMissingData(hashes, peerId).catch((err) =>
        logger.error(`[AntiEntropyManager] Failed to fetch listener data: ${(err as Error).message}`),
      );
    };
  }

  /**
   * The core scheduled task. Picks a peer and initiates the exchange.
   */
  private async performScheduledSync(): Promise<void> {
    // Mutex lock to prevent overlapping syncs on slow networks
    if (this.isSyncing) {
      logger.debug('[AntiEntropyManager] Skipping scheduled sync; a sync is already in progress.');
      return;
    }

    const connections = this.node.getConnections(); // TODO: should it use the peer registry instead?
    if (connections.length === 0) {
      return; // No peers to sync with
    }

    // Pick a random active connection
    const { item: randomConnection } = pickRandom(connections);
    const targetPeerId = randomConnection.remotePeer;

    this.isSyncing = true;
    try {
      await this.syncUntilConvergedOrExhausted(targetPeerId);
    } finally {
      this.isSyncing = false; // Always release the lock
    }
  }

  /**
   * Runs the exchange against a single peer and, on a partial (incomplete) outcome,
   * retries with exponential backoff up to `config.retry.maxRetries`. Hashes discovered
   * on each attempt are fetched immediately so partial progress is never wasted, and a
   * partial result is never logged as convergence. The loop aborts early if the manager
   * is stopped mid-backoff.
   */
  private async syncUntilConvergedOrExhausted(targetPeerId: PeerId): Promise<void> {
    const { maxRetries } = this.config.retry;

    for (let attempt = 0; ; attempt++) {
      logger.debug(
        `[AntiEntropyManager] Initiating sync with ${targetPeerId.toString()}` +
          (attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ''),
      );

      const outcome = await this.exchangeEngine.syncWithPeer(targetPeerId);

      if (!outcome) {
        // Stream could not be established; no diff info gained and nothing to retry against.
        logger.debug(
          `[AntiEntropyManager] Sync failed with peer ${targetPeerId.toString()} (exchange could not start).`,
        );
        return;
      }

      // Fetch whatever was discovered, even on a partial diff, so the work isn't wasted.
      if (outcome.hashes.length > 0) {
        await this.fetchMissingData(outcome.hashes, targetPeerId);
      }

      if (outcome.status === 'complete') {
        if (outcome.hashes.length === 0) {
          logger.debug(`[AntiEntropyManager] Fully converged with ${targetPeerId.toString()}. No missing data.`);
        }
        return;
      }

      // Partial outcome: do NOT treat as convergence. Retry with backoff if budget remains.
      if (attempt >= maxRetries) {
        logger.debug(
          `[AntiEntropyManager] Incomplete sync with ${targetPeerId.toString()} (reason=${outcome.reason}); ` +
            `exhausted ${maxRetries} retries, deferring to next scheduled cycle.`,
        );
        return;
      }

      if (!this.isRunning()) return; // Stopped during the exchange; do not schedule more work.

      const backoffMs = this.computeBackoffMs(attempt);
      logger.debug(
        `[AntiEntropyManager] Incomplete sync with ${targetPeerId.toString()} (reason=${outcome.reason}); ` +
          `retrying in ${backoffMs}ms.`,
      );
      await this.waitWithBackoff(backoffMs);

      if (!this.isRunning()) return; // Stopped while waiting on the backoff.
    }
  }

  /**
   * Exponential backoff (`base * 2^attempt`, capped) with equal jitter to avoid
   * synchronized retry storms across peers.
   */
  private computeBackoffMs(attempt: number): number {
    const { baseBackoffMs, maxBackoffMs } = this.config.retry;
    const capped = Math.min(baseBackoffMs * 2 ** attempt, maxBackoffMs);
    const half = capped / 2;
    return Math.round(half + Math.random() * half);
  }

  /**
   * A cancellable delay. stop() clears the timer and resolves the promise immediately
   * so the retry loop unblocks and tears down without leaking a timer.
   */
  private waitWithBackoff(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveRetryWait = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.resolveRetryWait = null;
        resolve();
      }, ms);
    });
  }

  private isRunning(): boolean {
    return this.syncTimer !== null;
  }

  /**
   * Delegates the actual retrieval of missing data to the Data Replication engine.
   *
   * @param hashes The exact sha256 missing message hashes.
   * @param targetPeerId The peer we know has the data.
   */
  private async fetchMissingData(hashes: readonly string[], targetPeerId: PeerId): Promise<void> {
    logger.info(`[AntiEntropyManager] Fetching ${hashes.length} missing messages from ${targetPeerId.toString()}`);

    for (const hash of hashes) {
      try {
        // TODO: Improvement - send all hashes at once and get back the data in one shot to improve performance
        await this.dataReplication.requestMissingData(hash, targetPeerId.toString());
      } catch (error) {
        logger.warn(
          `[AntiEntropyManager] Failed to request missing hash ${hash} from ${targetPeerId.toString()}: ${(error as Error).message}`,
        );
      }
    }
  }
}

export const antiEntropyManager = (): DeChatFactory<AntiEntropyManager> => {
  return (components: DeChatComponents) => new AntiEntropyManager(components);
};
