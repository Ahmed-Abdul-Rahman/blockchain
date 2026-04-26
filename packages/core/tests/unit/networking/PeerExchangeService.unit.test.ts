/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoopPeerExchangeMetrics } from '../../../src/metrics/noop/NoopPeerExchangeMetrics';
import { NoopPeerRegistryMetrics } from '../../../src/metrics/noop/NoopPeerRegistryMetrics';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { PeerRegistry } from '../../../src/networking/PeerRegistry';
import { SimplePeerScorer } from '../../../src/networking/SimplePeerScorer';

const PEX_TOPIC = '/deChat/core/peer-exchange-topic/1.0.0';
const PEX_PROTOCOL = '/deChat/core/peer-exchange-protocol/1.0.0';

describe('PeerExchangeService', () => {
  let mockNode: any;
  let mockPubsub: any;
  let mockDialQ: any;
  let scorer: SimplePeerScorer;
  let registry: PeerRegistry;
  let pexService: PeerExchangeService;

  beforeEach(() => {
    vi.useFakeTimers();

    mockPubsub = {
      subscribe: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      publish: vi.fn().mockResolvedValue(true),
    };

    mockNode = {
      peerId: {
        toString: () => 'self-peer-id',
      },
      services: { pubsub: mockPubsub },
      handle: vi.fn(),
      getConnections: vi.fn().mockReturnValue([]),
      getMultiaddrs: vi.fn().mockReturnValue([{ toString: () => '/ip4/127.0.0.1/tcp/0' }]),
    };

    mockDialQ = {
      enqueue: vi.fn(),
      stop: vi.fn(),
    };

    scorer = new SimplePeerScorer();
    registry = new PeerRegistry('self-peer-id', new NoopPeerRegistryMetrics());

    pexService = new PeerExchangeService(mockNode, scorer, mockDialQ, registry, new NoopPeerExchangeMetrics());
  });

  afterEach(() => {
    pexService.cleanUp();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('should subscribe to the PEX topic on initialization', () => {
    expect(mockPubsub.subscribe).toHaveBeenCalledWith(PEX_TOPIC);
    expect(mockPubsub.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    // This will now pass with the correctly matched PEX_PROTOCOL string
    expect(mockNode.handle).toHaveBeenCalledWith(PEX_PROTOCOL, expect.any(Function));
  });

  it('should enqueue peers for dialing if they are new (Bloom Filter)', () => {
    const peers = [{ peerId: 'peer-A', addresses: [] }];
    pexService.enqueueDial(peers);

    expect(mockDialQ.enqueue).toHaveBeenCalledWith(peers);

    mockDialQ.enqueue.mockClear();
    pexService.enqueueDial(peers);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);
  });

  it('should trigger gossip loop and publish known peers', async () => {
    // 1. Add a known peer to the registry
    registry.upsert({ peerId: 'peer-B', addresses: ['/ip4/192.168.1.1/tcp/8000'] });

    // 2. Mock an active connection so the gossip engine doesn't abort (assuming 0 connections = offline)
    mockNode.getConnections.mockReturnValue([{ remotePeer: { toString: () => 'active-peer' } }]);

    await pexService.initiatePeerExchange();

    // 3. FLUSH ASYNC TIMERS: Advance by 35 seconds to safely clear the base interval + any random Jitter.
    // Use `advanceTimersByTimeAsync` instead of the synchronous version to guarantee that
    // ALL nested Promises and microtasks inside the interval callback are fully resolved.
    await vi.advanceTimersByTimeAsync(35_000);

    // Ensure publish was successfully awaited and called
    expect(mockPubsub.publish).toHaveBeenCalledWith(PEX_TOPIC, expect.any(Uint8Array));
  });

  it('should penalize peers for sending invalid PEX messages', () => {
    const penalizeSpy = vi.spyOn(scorer, 'penalize');

    const fakeEvent = new CustomEvent('message', {
      detail: {
        topic: PEX_TOPIC,
        data: new TextEncoder().encode(
          JSON.stringify({
            from: 'malicious-peer',
            type: 'PEX_GOSSIP',
            peers: 'not-an-array',
          }),
        ),
      },
    });

    (pexService as any).onGossip(fakeEvent);

    expect(penalizeSpy).toHaveBeenCalledWith('malicious-peer', 5);
  });

  it('should cleanup resources and clear intervals on stop', () => {
    pexService.startPeerScoreDecay();
    pexService.cleanUp();

    expect(mockPubsub.removeEventListener).toHaveBeenCalled();
    expect(mockDialQ.stop).toHaveBeenCalled();
    expect((pexService as any).peerScoreDecayInterval).toBeNull();
  });
});
