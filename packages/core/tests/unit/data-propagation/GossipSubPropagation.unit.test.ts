/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GossipSubPropagation } from '../../../dist';
import { NoopGossipMetrics } from '../../../src/metrics';

describe('GossipSubPropagation', () => {
  let mockNode: any;
  let mockPubsub: any;
  let propagation: GossipSubPropagation;
  let metrics: NoopGossipMetrics;

  beforeEach(() => {
    metrics = new NoopGossipMetrics();
    mockPubsub = {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockNode = {
      services: { pubsub: mockPubsub },
    };

    propagation = new GossipSubPropagation(mockNode, metrics, 100, 60000, 1024);
  });

  afterEach(() => {
    propagation.stop();
    vi.clearAllMocks();
  });

  it('should initialize and register gossip listener', () => {
    expect(mockPubsub.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should publish messages via libp2p pubsub', async () => {
    const topic = 'test-topic';
    const message = { id: 'msg1', payload: 'hello', from: 'peerA', timestamp: Date.now() };

    // Need to subscribe first so topic is registered
    propagation.subscribe(topic, vi.fn());

    await propagation.publish(topic, message);

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      topic,
      expect.any(Uint8Array), // Serialized message
    );
  });

  it('should trigger handler on incoming unseen message and drop duplicates', () => {
    const topic = 'test-topic';
    const handler = vi.fn();
    propagation.subscribe(topic, handler);

    // Grab the registered listener
    const listener = mockPubsub.addEventListener.mock.calls[0][1];

    const message = { id: 'msg2', payload: 'data', from: 'peerB', timestamp: Date.now() };
    const event = new CustomEvent('message', {
      detail: {
        topic,
        data: new TextEncoder().encode(JSON.stringify(message)),
        from: 'peerB',
      },
    });

    // Fire event once
    listener(event);
    expect(handler).toHaveBeenCalledTimes(1);

    // Fire event again (Duplicate)
    listener(event);
    expect(handler).toHaveBeenCalledTimes(1); // Handler should not be called again
  });

  it('should clear messages cache', () => {
    const topic = 'test-topic';
    propagation.subscribe(topic, vi.fn());

    // Force a message into the seen cache
    const listener = mockPubsub.addEventListener.mock.calls[0][1];
    const message = { id: 'msg3', payload: 'data', from: 'peerC', timestamp: Date.now() };
    listener(
      new CustomEvent('message', {
        detail: { topic, data: new TextEncoder().encode(JSON.stringify(message)) },
      }),
    );

    expect(propagation.getSeenMessages().get(topic)?.has('msg3')).toBe(true);

    propagation.clearMessages(topic);
    expect(propagation.getSeenMessages().get(topic)?.has('msg3')).toBe(false);
  });
});
