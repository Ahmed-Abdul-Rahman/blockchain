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
  }

  /**
   * Starts the background synchronization scheduler and binds event listeners.
   */
  public start(): void {
    if (this.syncTimer) {
      logger.warn('[AntiEntropyManager] Sync manager is already running.');
      return;
    }

    // Bind the listener callback for Bidirectional Syncs
    this.exchangeEngine.onMissingHashesDiscovered = (hashes: string[], peerId: PeerId) => {
      this.fetchMissingData(hashes, peerId).catch((err) =>
        logger.error(`[AntiEntropyManager] Failed to fetch listener data: ${(err as Error).message}`),
      );
    };

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
    this.exchangeEngine.onMissingHashesDiscovered = undefined;
    logger.info('[AntiEntropyManager] Stopped background sync.');
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
      logger.debug(`[AntiEntropyManager] Initiating scheduled sync with ${targetPeerId.toString()}`);

      const missingHashes = await this.exchangeEngine.syncWithPeer(targetPeerId);

      if (missingHashes && missingHashes.length > 0) {
        await this.fetchMissingData(missingHashes, targetPeerId);
      } else if (missingHashes?.length === 0) {
        logger.debug(`[AntiEntropyManager] Fully converged with ${targetPeerId.toString()}. No missing data.`);
      } else {
        logger.debug(`[AntiEntropyManager] Sync failed with peer ${targetPeerId.toString()}.`);
      }
    } finally {
      this.isSyncing = false; // Always release the lock
    }
  }

  /**
   * Delegates the actual retrieval of missing data to the Data Replication engine.
   *
   * @param hashes The exact sha256 missing message hashes.
   * @param targetPeerId The peer we know has the data.
   */
  private async fetchMissingData(hashes: string[], targetPeerId: PeerId): Promise<void> {
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
