import { logger } from '@dechat/common';
import { Libp2p, PeerId, Startable } from '@libp2p/interface';
import { DeChatConfig } from '../config/types';
import { DataReplicationInterface } from '../data-replication/DataReplicationInterface';
import { AntiEntropyMetrics } from '../metrics/interfaces/AntiEntropyMetrics';
import { DeChatComponents, DeChatFactory } from '../types';
import { AntiEntropyNetworkExchange } from './AntiEntropyNetworkExchange';
import { AntiEntropyMetricsStore, createAntiEntropyMetricsStore, createSyncScheduler } from './scheduling';
import { computeUrgency } from './scheduling/math';
import { SyncAttemptRecord, SyncAttemptResult, SyncScheduler, SyncTickContext } from './scheduling/types';
import { SyncIncompleteReason } from './types';

/**
 * Orchestrates the background Anti-Entropy Data Convergence process.
 * Delegates when/with-whom decisions to a pluggable SyncScheduler;
 * the data plane (trie diff, auth, replication) stays deterministic.
 */
export class AntiEntropyManager implements Startable {
  /** Recursive setTimeout handle for the next scheduled sync tick */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the manager is actively scheduling sync ticks */
  private running = false;

  private isSyncing = false;

  /** Active backoff timer between partial-sync retries, tracked so stop() can cancel it. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolver for the in-flight backoff promise, used to unblock the retry loop on stop(). */
  private resolveRetryWait: (() => void) | null = null;

  private readonly node: Libp2p;
  private readonly exchangeEngine: AntiEntropyNetworkExchange;
  private readonly dataReplication: DataReplicationInterface;
  private readonly config: DeChatComponents['config']['strategies']['synchronizer'];
  private readonly adaptiveConfig: DeChatConfig['strategies']['synchronizer']['adaptive'];
  private readonly scheduler: SyncScheduler;
  private readonly metricsStore: AntiEntropyMetricsStore;
  private readonly metricsExport: AntiEntropyMetrics;

  constructor(components: DeChatComponents) {
    if (!components.strategies?.dataReplication) {
      throw new Error('AntiEntropyManager requires dataReplication strategy to be registered first.');
    }
    if (!components.strategies?.networkExchanger) {
      throw new Error('AntiEntropyManager requires antiEntropyExchange strategy to be registered first.');
    }

    this.node = components.libp2p;
    this.config = components.config.strategies.synchronizer;
    this.adaptiveConfig = this.config.adaptive;
    this.exchangeEngine = components.strategies.networkExchanger;
    this.dataReplication = components.strategies.dataReplication;
    this.metricsExport = components.metrics.antiEntropy;

    this.metricsStore = createAntiEntropyMetricsStore(this.config);
    components.antiEntropyMetrics = this.metricsStore;

    this.scheduler = createSyncScheduler(this.config, this.metricsStore);

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
    this.running = true;
    this.scheduleNext();

    logger.info(
      `[AntiEntropyManager] Started background sync (adaptive=${this.adaptiveConfig.enabled}, ` +
        `scheduler=${this.adaptiveConfig.scheduler})`,
    );
  }

  /**
   * Stops the background scheduler and cleans up listeners.
   */
  public stop(): void {
    this.running = false;

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.resolveRetryWait?.();
    this.resolveRetryWait = null;

    this.exchangeEngine.onMissingHashesDiscovered = undefined;
    logger.info('[AntiEntropyManager] Stopped background sync.');
  }

  /** Human-readable scheduler mode for logs (fixed vs adaptive strategy name). */
  private schedulerModeLabel(): string {
    if (!this.adaptiveConfig.enabled) {
      return 'fixed';
    }
    return this.adaptiveConfig.scheduler;
  }

  /**
   * Schedules the next sync tick using the scheduler's dynamic interval.
   */
  private scheduleNext(): void {
    if (!this.running) {
      return;
    }

    const ctx = this.buildTickContext();
    const delayMs = this.scheduler.nextIntervalMs(ctx);
    const wouldIdleSkipWithoutFloor =
      this.adaptiveConfig.enabled && this.scheduler.shouldSkipTick({ ...ctx, forceFloorSync: false });
    const wouldSkip = wouldIdleSkipWithoutFloor && !ctx.forceFloorSync;

    logger.debug(
      `[AntiEntropyManager] Scheduling next tick in ${delayMs}ms ` +
        `(mode=${this.schedulerModeLabel()}, urgency=${computeUrgency(ctx.stateVector).toFixed(2)}, ` +
        `zeroHashStreak=${ctx.consecutiveZeroHashComplete}, wouldSkip=${wouldSkip}, ` +
        `forceFloor=${ctx.forceFloorSync}, activity=${ctx.stateVector[5].toFixed(2)})`,
    );

    this.syncTimer = setTimeout(() => {
      void this.performScheduledSync()
        .catch((err) => logger.error(`[AntiEntropyManager] Scheduled sync failed: ${(err as Error).message}`))
        .finally(() => this.scheduleNext());
    }, delayMs);
  }

  /**
   * Binds the listener-side callback used when inbound bidirectional syncs discover gaps.
   */
  private bindMissingHashesListener(): void {
    this.exchangeEngine.onMissingHashesDiscovered = (hashes: readonly string[], peerId: PeerId) => {
      const peerIdStr = peerId.toString();
      this.metricsStore.recordInboundHashes(peerIdStr, hashes.length);
      this.metricsExport.inboundSyncDiscoveredHashes(peerIdStr, hashes.length);

      this.fetchMissingData(hashes, peerId).catch((err) =>
        logger.error(`[AntiEntropyManager] Failed to fetch listener data: ${(err as Error).message}`),
      );
    };
  }

  /**
   * Builds tick context from current metrics for scheduler policy evaluation.
   */
  private buildTickContext(): SyncTickContext {
    const now = Date.now();
    const timeSinceLastSyncMs = this.metricsStore.getTimeSinceLastSyncMs(now);
    const maxInterval = this.adaptiveConfig.maxIntervalMs ?? this.config.syncIntervalMs;

    // Floor sync: force a tick when we have not synced within maxIntervalMs
    const forceFloorSync = this.adaptiveConfig.enabled && timeSinceLastSyncMs >= maxInterval;

    return {
      now,
      timeSinceLastSyncMs,
      timeSinceLastUsefulSyncMs: this.metricsStore.getTimeSinceLastUsefulSyncMs(now),
      consecutiveZeroHashComplete: this.metricsStore.getConsecutiveZeroHashComplete(),
      stateVector: this.metricsStore.getStateVector(now),
      forceFloorSync,
    };
  }

  /**
   * The core scheduled task. Evaluates skip policy, picks a peer, and initiates sync.
   */
  private async performScheduledSync(): Promise<void> {
    this.metricsStore.recordScheduledTickStarted();
    this.metricsExport.scheduledTickStarted();

    const ctx = this.buildTickContext();
    const wouldIdleSkipWithoutFloor =
      this.adaptiveConfig.enabled && this.scheduler.shouldSkipTick({ ...ctx, forceFloorSync: false });

    if (wouldIdleSkipWithoutFloor && !ctx.forceFloorSync) {
      this.metricsStore.recordSkip('idle_skip');
      this.metricsExport.scheduledTickSkipped('idle_skip');
      logger.debug(
        `[AntiEntropyManager] Skipping scheduled sync; room appears idle ` +
          `(mode=${this.schedulerModeLabel()}, zeroHashStreak=${ctx.consecutiveZeroHashComplete}, ` +
          `activity=${ctx.stateVector[5].toFixed(2)})`,
      );
      return;
    }

    if (ctx.forceFloorSync && wouldIdleSkipWithoutFloor) {
      this.metricsStore.recordSkip('floor_sync_forced');
      this.metricsExport.scheduledTickSkipped('floor_sync_forced');
      logger.debug(
        `[AntiEntropyManager] Floor sync override; forcing tick despite idle state ` +
          `(mode=${this.schedulerModeLabel()}, timeSinceLastSyncMs=${ctx.timeSinceLastSyncMs})`,
      );
    }

    if (this.isSyncing) {
      this.metricsStore.recordSkip('mutex');
      this.metricsExport.scheduledTickSkipped('mutex');
      logger.debug('[AntiEntropyManager] Skipping scheduled sync; a sync is already in progress.');
      return;
    }

    // TODO: consider PeerRegistry authenticated peers instead of raw connections
    const connections = this.node.getConnections();
    if (connections.length === 0) {
      this.metricsStore.recordSkip('no_peers');
      this.metricsExport.scheduledTickSkipped('no_peers');
      return;
    }

    const candidates = connections.map((c) => c.remotePeer);
    const targetPeerId = this.scheduler.pickPeer(candidates);
    const peerIdStr = targetPeerId.toString();
    const peerScore = this.metricsStore.getPeerConvergenceTracker().getScore(peerIdStr);
    const startedAt = Date.now();

    logger.debug(
      `[AntiEntropyManager] Outbound sync tick ` +
        `(mode=${this.schedulerModeLabel()}, peer=${peerIdStr}, convergenceScore=${peerScore.toFixed(2)}, ` +
        `candidates=${candidates.length})`,
    );

    this.metricsExport.outboundSyncStarted(peerIdStr);
    this.isSyncing = true;

    try {
      const result = await this.syncUntilConvergedOrExhausted(targetPeerId);
      const durationMs = Date.now() - startedAt;

      const record: SyncAttemptRecord = {
        peerId: peerIdStr,
        startedAt,
        durationMs,
        result,
      };

      this.metricsStore.recordOutboundAttempt(record);
      this.metricsExport.outboundSyncCompleted(record);
      this.scheduler.onOutboundSyncComplete(record);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Runs the exchange against a single peer and, on a partial (incomplete) outcome,
   * retries with exponential backoff up to `config.retry.maxRetries`.
   */
  private async syncUntilConvergedOrExhausted(targetPeerId: PeerId): Promise<SyncAttemptResult> {
    const { maxRetries } = this.config.retry;
    let totalHashesDiscovered = 0;
    let lastPartialReason: SyncIncompleteReason = 'timeout';

    for (let attempt = 0; ; attempt++) {
      logger.debug(
        `[AntiEntropyManager] Initiating sync with ${targetPeerId.toString()}` +
          (attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ''),
      );

      const outcome = await this.exchangeEngine.syncWithPeer(targetPeerId);

      if (!outcome) {
        logger.debug(
          `[AntiEntropyManager] Sync failed with peer ${targetPeerId.toString()} (exchange could not start).`,
        );
        return { kind: 'failed', durationMs: 0 };
      }

      if (outcome.hashes.length > 0) {
        totalHashesDiscovered += outcome.hashes.length;
        await this.fetchMissingData(outcome.hashes, targetPeerId);
      }

      if (outcome.status === 'complete') {
        if (outcome.hashes.length === 0) {
          logger.debug(`[AntiEntropyManager] Fully converged with ${targetPeerId.toString()}. No missing data.`);
        }
        return {
          kind: 'complete',
          hashesDiscovered: totalHashesDiscovered,
          durationMs: 0,
        };
      }

      lastPartialReason = outcome.reason;

      if (attempt >= maxRetries) {
        logger.debug(
          `[AntiEntropyManager] Incomplete sync with ${targetPeerId.toString()} (reason=${outcome.reason}); ` +
            `exhausted ${maxRetries} retries, deferring to next scheduled cycle.`,
        );
        return {
          kind: 'partial',
          hashesDiscovered: totalHashesDiscovered,
          durationMs: 0,
          reason: lastPartialReason,
        };
      }

      if (!this.isRunning()) {
        return {
          kind: 'partial',
          hashesDiscovered: totalHashesDiscovered,
          durationMs: 0,
          reason: lastPartialReason,
        };
      }

      const backoffMs = this.computeBackoffMs(attempt);
      logger.debug(
        `[AntiEntropyManager] Incomplete sync with ${targetPeerId.toString()} (reason=${outcome.reason}); ` +
          `retrying in ${backoffMs}ms.`,
      );
      await this.waitWithBackoff(backoffMs);

      if (!this.isRunning()) {
        return {
          kind: 'partial',
          hashesDiscovered: totalHashesDiscovered,
          durationMs: 0,
          reason: lastPartialReason,
        };
      }
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
    return this.running;
  }

  /**
   * Delegates the actual retrieval of missing data to the Data Replication engine.
   */
  private async fetchMissingData(hashes: readonly string[], targetPeerId: PeerId): Promise<void> {
    logger.info(`[AntiEntropyManager] Fetching ${hashes.length} missing messages from ${targetPeerId.toString()}`);

    const peerIdStr = targetPeerId.toString();

    for (const hash of hashes) {
      const fetchStart = Date.now();
      this.metricsStore.recordFetchHashStarted(peerIdStr, hash);
      this.metricsExport.fetchHashStarted(peerIdStr, hash);

      try {
        await this.dataReplication.requestMissingData(hash, peerIdStr);
        const durationMs = Date.now() - fetchStart;
        this.metricsStore.recordFetchHashCompleted(peerIdStr, hash, durationMs, true);
        this.metricsExport.fetchHashCompleted(peerIdStr, hash, durationMs, true);
      } catch (error) {
        const durationMs = Date.now() - fetchStart;
        this.metricsStore.recordFetchHashCompleted(peerIdStr, hash, durationMs, false);
        this.metricsExport.fetchHashCompleted(peerIdStr, hash, durationMs, false);
        logger.warn(
          `[AntiEntropyManager] Failed to request missing hash ${hash} from ${peerIdStr}: ${(error as Error).message}`,
        );
      }
    }
  }
}

export const antiEntropyManager = (): DeChatFactory<AntiEntropyManager> => {
  return (components: DeChatComponents) => new AntiEntropyManager(components);
};
