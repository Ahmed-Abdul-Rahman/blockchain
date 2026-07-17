import { describe, expect, it, vi } from 'vitest';
import type { AntiEntropyMetricsSnapshot } from '../../../src/data-convergence/scheduling/AntiEntropyMetricsStore';
import {
  createWorkerThreadTransport,
  mapAntiEntropySnapshot,
  type NodeRunnerInboundMessage,
  type NodeRunnerOutboundMessage,
} from '../../interop/nodeRunner';

const emptySnapshot = (): AntiEntropyMetricsSnapshot => ({
  outboundAttempts: 3,
  usefulSyncs: 2,
  lastSyncHashes: 5,
  consecutiveZeroHashComplete: 0,
  skipCounts: {
    mutex: 0,
    no_peers: 0,
    idle_skip: 4,
    floor_sync_forced: 1,
  },
  scheduledTicks: 10,
  stateVector: [0, 0, 0, 0, 0, 0.42, 0],
});

describe('nodeRunner transport seam', () => {
  it('maps anti-entropy snapshots into WorkerResult.antiEntropy shape', () => {
    const mapped = mapAntiEntropySnapshot(emptySnapshot(), 1_250);
    expect(mapped).toEqual({
      outboundAttempts: 3,
      usefulSyncs: 2,
      lastSyncHashes: 5,
      idleSkips: 4,
      floorSyncForces: 1,
      scheduledTicks: 10,
      zeroHashStreak: 0,
      activityScore: 0.42,
      convergenceMs: 1_250,
    });
  });

  it('forwards worker-thread messages through createWorkerThreadTransport', async () => {
    const listeners: Array<(message: NodeRunnerInboundMessage) => void> = [];
    const posted: NodeRunnerOutboundMessage[] = [];
    const exit = vi.fn();

    const port = {
      on: (_event: 'message', listener: (message: NodeRunnerInboundMessage) => void) => {
        listeners.push(listener);
      },
      postMessage: (message: NodeRunnerOutboundMessage) => {
        posted.push(message);
      },
    };

    const transport = createWorkerThreadTransport(port, exit);
    const handled: string[] = [];
    transport.onMessage(async (message) => {
      handled.push(message.type);
    });

    listeners[0]?.({ type: 'statistics' });
    await vi.waitFor(() => expect(handled).toEqual(['statistics']));

    transport.postMessage({ type: 'connect_peers_done', index: 2 });
    expect(posted).toEqual([{ type: 'connect_peers_done', index: 2 }]);

    transport.exit(0);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
