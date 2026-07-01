/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { logger } from '@dechat/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { AntiEntropyManager, antiEntropyManager } from '../../../src/data-convergence/AntiEntropyManager';
import { SyncOutcome } from '../../../src/data-convergence/types';
import { NoopAntiEntropyMetrics } from '../../../src/metrics/noop/NoopAntiEntropyMetrics';
import { DeChatComponents } from '../../../src/types';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const partial = (hashes: string[], reason: 'timeout' | 'badResponse' | 'depthCap'): SyncOutcome => ({
  status: 'partial',
  hashes,
  reason,
});

const complete = (hashes: string[]): SyncOutcome => ({ status: 'complete', hashes });

describe('AntiEntropyManager', () => {
  let manager: AntiEntropyManager;
  let mockComponents: Partial<DeChatComponents>;
  let mockExchange: any;
  let mockDataReplication: any;
  let mockLibp2p: any;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  const targetPeerId = { toString: () => 'peer-1' } as any;

  const runConvergeLoop = async (): Promise<void> => {
    const run = (manager as any).syncUntilConvergedOrExhausted(targetPeerId);
    // Drives the async retry loop AND any pending backoff timers to completion.
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

    mockExchange = {
      syncWithPeer: vi.fn(),
      onMissingHashesDiscovered: undefined,
    };
    mockDataReplication = {
      requestMissingData: vi.fn().mockResolvedValue(undefined),
    };
    mockLibp2p = {
      getConnections: vi.fn().mockReturnValue([{ remotePeer: targetPeerId }]),
    };

    mockComponents = {
      libp2p: mockLibp2p,
      config: {
        strategies: {
          synchronizer: {
            ...DECHAT_DEFAULTS.strategies.synchronizer,
            // Huge interval so the scheduler never auto-fires during a test.
            syncIntervalMs: 1_000_000,
            retry: { maxRetries: 3, baseBackoffMs: 10, maxBackoffMs: 50 },
          },
        },
      } as DeChatComponents['config'],
      metrics: {
        antiEntropy: new NoopAntiEntropyMetrics(),
      } as DeChatComponents['metrics'],
      strategies: {
        dataReplication: mockDataReplication,
        networkExchanger: mockExchange,
      } as any,
    };

    manager = antiEntropyManager()(mockComponents as DeChatComponents);
    // start() arms syncTimer; isRunning() (which gates retries) depends on it.
    manager.start();
  });

  afterEach(() => {
    manager.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('wires the listener callback in the constructor (before start)', () => {
    const freshExchange: any = { syncWithPeer: vi.fn(), onMissingHashesDiscovered: undefined };
    antiEntropyManager()({
      ...mockComponents,
      strategies: { dataReplication: mockDataReplication, networkExchanger: freshExchange },
    } as DeChatComponents);

    expect(typeof freshExchange.onMissingHashesDiscovered).toBe('function');
  });

  it('fetches discovered hashes and converges without retrying on a complete outcome', async () => {
    mockExchange.syncWithPeer.mockResolvedValue(complete([HASH_A, HASH_B]));

    await runConvergeLoop();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(1);
    expect(mockDataReplication.requestMissingData).toHaveBeenCalledTimes(2);
    expect(mockDataReplication.requestMissingData).toHaveBeenCalledWith(HASH_A, 'peer-1');
    expect(mockDataReplication.requestMissingData).toHaveBeenCalledWith(HASH_B, 'peer-1');
  });

  it('logs convergence only on a complete + empty diff', async () => {
    mockExchange.syncWithPeer.mockResolvedValue(complete([]));

    await runConvergeLoop();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(1);
    expect(mockDataReplication.requestMissingData).not.toHaveBeenCalled();
    expect(debugSpy.mock.calls.some(([m]) => String(m).includes('Fully converged'))).toBe(true);
  });

  it('does not retry and does not fetch when the exchange could not start (null)', async () => {
    mockExchange.syncWithPeer.mockResolvedValue(null);

    await runConvergeLoop();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(1);
    expect(mockDataReplication.requestMissingData).not.toHaveBeenCalled();
  });

  it('retries a partial outcome with backoff, then stops once converged', async () => {
    mockExchange.syncWithPeer.mockResolvedValueOnce(partial([HASH_A], 'timeout')).mockResolvedValueOnce(complete([]));

    await runConvergeLoop();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(2);
    // The partial hash discovered on the first attempt is still fetched (no wasted work).
    expect(mockDataReplication.requestMissingData).toHaveBeenCalledTimes(1);
    expect(mockDataReplication.requestMissingData).toHaveBeenCalledWith(HASH_A, 'peer-1');
    // A partial outcome must never be reported as convergence.
    expect(debugSpy.mock.calls.some(([m]) => String(m).includes('Fully converged'))).toBe(true);
  });

  it('stops after maxRetries on persistent partials and never claims convergence', async () => {
    mockExchange.syncWithPeer.mockResolvedValue(partial([HASH_A], 'badResponse'));

    await runConvergeLoop();

    // 1 initial attempt + maxRetries (3) = 4 total exchanges.
    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(4);
    // Hashes are fetched opportunistically on every attempt.
    expect(mockDataReplication.requestMissingData).toHaveBeenCalledTimes(4);
    expect(debugSpy.mock.calls.some(([m]) => String(m).includes('Fully converged'))).toBe(false);
    expect(debugSpy.mock.calls.some(([m]) => String(m).includes('exhausted 3 retries'))).toBe(true);
  });

  it('respects config.retry.maxRetries = 0 (no retries)', async () => {
    (manager as any).config.retry.maxRetries = 0;
    mockExchange.syncWithPeer.mockResolvedValue(partial([], 'timeout'));

    await runConvergeLoop();

    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(1);
  });

  it('aborts the retry loop and leaks no timers when stopped mid-backoff', async () => {
    mockExchange.syncWithPeer.mockResolvedValue(partial([], 'timeout'));

    const run = (manager as any).syncUntilConvergedOrExhausted(targetPeerId);
    // Flush microtasks up to the point the first backoff timer is scheduled (it is >0ms,
    // so advancing by 0 will not fire it — it stays pending).
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

    manager.stop();
    await run;

    // Loop saw the stop and bailed before any retry.
    expect(mockExchange.syncWithPeer).toHaveBeenCalledTimes(1);
    // No dangling interval or backoff timers remain after teardown.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('performScheduledSync skips when there are no active connections', async () => {
    mockLibp2p.getConnections.mockReturnValue([]);

    await (manager as any).performScheduledSync();

    expect(mockExchange.syncWithPeer).not.toHaveBeenCalled();
  });

  it('performScheduledSync honors the in-progress mutex', async () => {
    (manager as any).isSyncing = true;

    await (manager as any).performScheduledSync();

    expect(mockExchange.syncWithPeer).not.toHaveBeenCalled();
  });

  it('applies exponential backoff with equal jitter, capped at maxBackoffMs', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // jitter -> lower bound (capped/2)
    const compute = (attempt: number): number => (manager as any).computeBackoffMs(attempt);

    // base=10, max=50: attempt 0 -> 10, 1 -> 20, 2 -> 40, 3 -> capped to 50.
    expect(compute(0)).toBe(5); // 10/2
    expect(compute(1)).toBe(10); // 20/2
    expect(compute(2)).toBe(20); // 40/2
    expect(compute(3)).toBe(25); // min(80,50)=50 -> 50/2

    randomSpy.mockReturnValue(0.9999);
    expect(compute(3)).toBeLessThanOrEqual(50); // never exceeds the cap even at max jitter
    randomSpy.mockRestore();
  });

  it('stop() clears pending setTimeout (no dangling timers)', () => {
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    manager.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses fixed interval when adaptive.enabled is false', () => {
    const intervalMs = 5_000;
    const fixedManager = antiEntropyManager()({
      ...mockComponents,
      config: {
        strategies: {
          synchronizer: {
            ...DECHAT_DEFAULTS.strategies.synchronizer,
            syncIntervalMs: intervalMs,
            adaptive: { ...DECHAT_DEFAULTS.strategies.synchronizer.adaptive, enabled: false },
          },
        },
      },
      metrics: { antiEntropy: new NoopAntiEntropyMetrics() },
      strategies: mockComponents.strategies,
    } as DeChatComponents);

    const delay = (fixedManager as any).scheduler.nextIntervalMs((fixedManager as any).buildTickContext());
    expect(delay).toBe(intervalMs);
    fixedManager.stop();
  });

  it('records mutex skip when sync is already in progress', async () => {
    (manager as any).isSyncing = true;
    await (manager as any).performScheduledSync();

    const snap = (manager as any).metricsStore.snapshot();
    expect(snap.skipCounts.mutex).toBe(1);
  });
});
