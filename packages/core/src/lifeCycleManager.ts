import { logger } from '@dechat/common';
import { Libp2p } from '@libp2p/interface';
import { DialQueue } from './DialQueue';
import { PeerExchangeService } from './PeerExchangeService';
import { SimplePeerScorer } from './SimplePeerScorer';

export type CleanupTask = {
  name: string;
  priority: number; // Lower runs first
  cleanup: () => Promise<void> | void;
};

export class LifecycleManager {
  private cleanupTasks: CleanupTask[] = [];
  private timers: NodeJS.Timeout[] = [];
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * Register a cleanup task
   * @param name - Descriptive name for the task
   * @param cleanup - Async or sync cleanup function
   * @param priority - Execution order (lower = earlier)
   */
  registerCleanup(name: string, cleanup: () => Promise<void> | void, priority = 50): void {
    this.cleanupTasks.push({ name, cleanup, priority });
    this.cleanupTasks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Register a timer that should be cleared on shutdown
   * @param timer - NodeJS.Timeout from setInterval/setTimeout
   */
  registerTimer(timer: NodeJS.Timeout): void {
    this.timers.push(timer);
  }

  /**
   * Execute all cleanup tasks in priority order
   * @param signal - Optional AbortSignal for timeout
   */
  async shutdown(signal?: AbortSignal): Promise<void> {
    if (this.isShuttingDown) {
      logger.debug('Shutdown already in progress');
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.executeShutdown(signal);
    return this.shutdownPromise;
  }

  private async executeShutdown(signal?: AbortSignal): Promise<void> {
    logger.info('Starting graceful shutdown', {
      cleanupTasks: this.cleanupTasks.length,
      activeTimers: this.timers.length,
    });

    const startTime = Date.now();

    // Clear all timers first
    logger.debug('Clearing timers', { count: this.timers.length });
    for (const timer of this.timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers = [];

    // Execute cleanup tasks in priority order
    for (const task of this.cleanupTasks) {
      if (signal?.aborted) {
        logger.warn('Shutdown aborted, remaining tasks skipped');
        break;
      }

      try {
        logger.debug(`Executing cleanup: ${task.name}`, { priority: task.priority });
        await Promise.race([
          task.cleanup(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 5000)),
        ]);
        logger.debug(`Cleanup completed: ${task.name}`);
      } catch (error) {
        logger.error(`Cleanup failed: ${task.name}`, { error });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Graceful shutdown completed', { durationMs: duration });
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdown(): boolean {
    return this.isShuttingDown;
  }
}

/**
 * Factory function to create a fully managed node with proper lifecycle
 */
export const createManagedNode = async (
  node: Libp2p,
  pexService: PeerExchangeService,
  dialQueue: DialQueue,
): Promise<{ node: Libp2p; lifecycle: LifecycleManager }> => {
  const lifecycle = new LifecycleManager();

  // Register PEX cleanup (highest priority)
  lifecycle.registerCleanup(
    'PeerExchangeService',
    async () => {
      logger.debug('Stopping peer exchange gossip');
      pexService.stopGossip();
    },
    10,
  );

  // Register DialQueue cleanup
  lifecycle.registerCleanup(
    'DialQueue',
    async () => {
      logger.debug('Stopping dial queue');
      dialQueue.stop();
    },
    20,
  );

  // Register libp2p cleanup (lowest priority - do last)
  lifecycle.registerCleanup(
    'Libp2p',
    async () => {
      logger.debug('Stopping libp2p node');
      await node.stop();
    },
    100,
  );

  // Setup signal handlers for graceful shutdown
  if (typeof process !== 'undefined') {
    const handleSignal = (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown`);
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        logger.warn('Shutdown timeout exceeded, forcing exit');
        process.exit(1);
      }, 30000); // 30 second hard timeout

      lifecycle
        .shutdown(controller.signal)
        .then(() => {
          clearTimeout(timeout);
          logger.info('Shutdown complete');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('Shutdown failed', { error });
          process.exit(1);
        });
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
  }

  return { node, lifecycle };
};
