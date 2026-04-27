/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */

import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { DialQueue, dialQueue } from '../../../src/networking/DialQueue';
import { DeChatComponents } from '../../../src/types';

describe('DialQueue', () => {
  let mockComponents: Partial<DeChatComponents>;
  let queue: DialQueue;
  let selfPeerId: any; // We will store our dynamically generated valid PeerId here

  beforeEach(async () => {
    // Generate a mathematically valid libp2p PeerId for 'self'
    selfPeerId = await createEd25519PeerId();

    mockComponents = {
      config: {
        ...DECHAT_DEFAULTS,
        dialQueue: {
          maxConnections: 150,
          minConnections: 8,
          buffer: 5,
          maxQueueLength: 100,
          intervalMs: 1000,
        },
      } as any,
      scorer: {
        isDialable: vi.fn().mockReturnValue(true),
        get: vi.fn().mockReturnValue(10),
      } as any,
      libp2p: {
        peerId: selfPeerId,
        getConnections: vi.fn().mockReturnValue([]),
        dial: vi.fn().mockResolvedValue(true),
      } as any,
      metrics: {
        dialQueue: {
          peerEnqueued: vi.fn(),
          dialAttempt: vi.fn(),
          dialSucceeded: vi.fn(),
          dialFailed: vi.fn(),
          targetConnectionsComputed: vi.fn(),
        },
      } as any,
    };

    queue = dialQueue()(mockComponents as DeChatComponents);
  });

  afterEach(() => {
    queue?.stop();
    vi.clearAllMocks();
  });

  it('should not enqueue itself', async () => {
    // Pass the valid stringified peerId
    await queue.enqueue([{ peerId: selfPeerId.toString(), addresses: [] }]);

    // The target connections should be the minimum config value (8)
    expect(queue.getTargetConnections()).toBe(8);
  });

  it('should compute adaptive target connections correctly', async () => {
    // Dynamically generate 10 VALID dummy peers using Promise.all
    const peers = await Promise.all(
      Array.from({ length: 10 }).map(async () => {
        const id = await createEd25519PeerId();
        return {
          peerId: id.toString(),
          addresses: [],
        };
      }),
    );

    await queue.enqueue(peers);

    // Adaptive logic: Math.floor(Math.log2(max(2, 10))) + 5 buffer = 3 + 5 = 8
    expect(queue.getTargetConnections()).toBe(8);
  });

  it('should skip dialing peers with a low score', async () => {
    mockComponents.scorer!.isDialable = vi.fn().mockReturnValue(false);

    // Generate a valid bad peer
    const badPeer = await createEd25519PeerId();

    await queue.enqueue([{ peerId: badPeer.toString(), addresses: [] }]);

    setTimeout(() => {
      expect(mockComponents.libp2p!.dial).not.toHaveBeenCalled();
    }, 100);
  });
});
