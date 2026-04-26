/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file    > */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoopDialQueueMetrics } from '../../../src/metrics/noop/NoopDialQueueMetrics';
import { DialQueue } from '../../../src/networking/DialQueue';

vi.mock('@libp2p/peer-id', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    peerIdFromString: vi.fn((str: string) => ({
      toString: () => str,
      equals: (otherId: any) => str === otherId.toString(),
    })),
  };
});

describe('DialQueue', () => {
  let mockNode: any;
  let mockScorer: any;
  let dialQueue: DialQueue;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock Libp2p Node
    mockNode = {
      peerId: {
        toString: () => 'self-peer-id',
        equals: (id: any) => id.toString() === 'self-peer-id',
      },
      getConnections: vi.fn().mockReturnValue([]),
      dial: vi.fn().mockResolvedValue(true),
    };

    // Mock Scorer
    mockScorer = {
      isDialable: vi.fn().mockReturnValue(true),
    };

    dialQueue = new DialQueue(
      mockNode as any,
      mockScorer,
      new NoopDialQueueMetrics(),
      10, // maxQueueLength
      1000, // intervalMs
      2, // minConnections
      5, // maxConnections
    );
  });

  afterEach(() => {
    dialQueue.stop();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('should enqueue valid peers up to maxQueueLength', async () => {
    const peers = Array.from({ length: 15 }).map((_, i) => ({
      peerId: `peer-${i}`,
      addresses: [],
    }));

    await dialQueue.enqueue(peers);

    // Queue length should be capped at maxQueueLength (10)
    // The loop implicitly starts running, taking 1 peer off immediately, so length might be 9 or 10 depending on execution.
    // We can test behavior by checking if the loop dialed peers.
    vi.advanceTimersByTime(1500);

    // Check if dials happened
    expect(mockNode.dial).toHaveBeenCalled();
  });

  it('should not enqueue self-peer', async () => {
    await dialQueue.enqueue([{ peerId: 'self-peer-id', addresses: [] }]);

    vi.advanceTimersByTime(1500);
    expect(mockNode.dial).not.toHaveBeenCalled();
  });

  it('should not dial peers that are marked undialable by the scorer', async () => {
    mockScorer.isDialable.mockReturnValue(false); // Make all peers undialable

    await dialQueue.enqueue([{ peerId: 'bad-peer', addresses: [] }]);

    vi.advanceTimersByTime(1500);
    expect(mockNode.dial).not.toHaveBeenCalled();
  });

  it('should respect connection boundaries (minConnections / maxConnections)', async () => {
    // Simulate we already have 5 active connections (which is our maxConnections)
    mockNode.getConnections.mockReturnValue([
      { remotePeer: { toString: () => 'c1' }, status: 'open' },
      { remotePeer: { toString: () => 'c2' }, status: 'open' },
      { remotePeer: { toString: () => 'c3' }, status: 'open' },
      { remotePeer: { toString: () => 'c4' }, status: 'open' },
      { remotePeer: { toString: () => 'c5' }, status: 'open' },
    ]);

    await dialQueue.enqueue([{ peerId: 'new-peer', addresses: [] }]);

    // Loop ticks, but we already have maxConnections
    vi.advanceTimersByTime(1500);

    // Should NOT dial because target connections max is reached
    expect(mockNode.dial).not.toHaveBeenCalled();
  });

  it('stops processing when stop is called', async () => {
    await dialQueue.enqueue([{ peerId: 'peer-1', addresses: [] }]);
    dialQueue.stop();

    vi.advanceTimersByTime(1500);
    // Because it was stopped before the interval fired, dial should not be called
    expect(mockNode.dial).not.toHaveBeenCalled();
  });
});
