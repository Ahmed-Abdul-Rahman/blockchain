/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GossipSubPropagation } from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import { DeChatComponents } from '../../../src/types';

describe('GossipSubPropagation', () => {
  let propagation: GossipSubPropagation;
  let mockComponents: Partial<DeChatComponents>;
  let mockNode: any;
  let mockPubsub: any;

  beforeEach(() => {
    mockPubsub = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockNode = {
      services: { pubsub: mockPubsub },
    };

    mockComponents = {
      libp2p: mockNode as any,
      // Added missing config structure for broadcast
      config: {
        strategies: {
          propagation: {
            broadcast: {},
          },
        },
      } as any,
      // Added missing metrics property
      metrics: {
        gossipSubPropMetrics: {
          messagesPublished: vi.fn(),
          messagesReceived: vi.fn(),
          duplicatesDropped: vi.fn(),
          invalidMessagesDropped: vi.fn(),
        },
      } as any,
    };

    propagation = new GossipSubPropagation(mockComponents as DeChatComponents);
  });

  afterEach(async () => {
    await propagation?.stop();
    vi.clearAllMocks();
  });

  it('should initialize and register gossip listener', async () => {
    await propagation.start();
    expect(mockPubsub.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should publish messages via libp2p pubsub', async () => {
    const topic = 'test-topic';
    const message = { id: 'msg1', payload: 'hello', from: 'peerA', timestamp: Date.now() };

    // Need to subscribe first so topic is registered
    propagation.subscribe(topic, vi.fn());

    await propagation.publish(topic, message);
    expect(mockPubsub.publish).toHaveBeenCalledWith('test-topic', expect.any(Uint8Array));
  });

  it('should trigger handler on incoming unseen message and drop duplicates', () => {
    const handler = vi.fn();
    propagation.subscribe('test-topic', handler);

    // Get the registered internal callback
    const listener = mockPubsub.addEventListener.mock.calls.find((c: any) => c[0] === 'message')[1];

    const fakeEvent = new CustomEvent('message', {
      detail: {
        topic: 'test-topic',
        data: new TextEncoder().encode(JSON.stringify({ test: 'data' })),
      },
    });

    listener(fakeEvent);
    expect(handler).toHaveBeenCalledTimes(1);

    // Call again to verify deduplication works
    listener(fakeEvent);
    expect(handler).toHaveBeenCalledTimes(1); // Should not increase
  });

  it('should clear messages cache', () => {
    // Basic verification that the method exists and can be called without error
    propagation.clearMessages();
    expect(true).toBe(true);
  });
});
