/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { NoopPeerExchangeMetrics } from '../../../src/metrics';
import { PeerExchangeService, peerExchangeService } from '../../../src/networking/PeerExchangeService';
import { PEX_PROTOCOL, PEX_TOPIC } from '../../../src/networking/protocols';
import { DeChatComponents } from '../../../src/types';

describe('PeerExchangeService', () => {
  let mockComponents: Partial<DeChatComponents>;
  let pexService: PeerExchangeService;
  let mockPubsub: any;
  let mockNode: any;
  let mockDialQ: any;
  let mockScorer: any;
  let mockRegistry: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockPubsub = {
      subscribe: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      publish: vi.fn().mockResolvedValue(true),
    };

    mockNode = {
      peerId: { toString: () => 'self-peer-id' },
      services: { pubsub: mockPubsub },
      handle: vi.fn(),
      unhandle: vi.fn(),
      getConnections: vi.fn().mockReturnValue([]),
      // Fix: Added missing getMultiaddrs method!
      getMultiaddrs: vi.fn().mockReturnValue([{ toString: () => '/ip4/127.0.0.1/tcp/0' }]),
    };

    mockDialQ = {
      enqueue: vi.fn(),
    };

    mockScorer = {
      reward: vi.fn(),
      penalize: vi.fn(),
    };

    mockRegistry = {
      upsert: vi.fn(),
      upsertMany: vi.fn(),
      getCandidates: vi.fn().mockReturnValue([]),
    };

    mockComponents = {
      libp2p: mockNode as any,
      config: DECHAT_DEFAULTS,
      dialQueue: mockDialQ as any,
      scorer: mockScorer as any,
      peerRegistry: mockRegistry as any,
      metrics: { pexService: new NoopPeerExchangeMetrics() } as any,
    };

    pexService = peerExchangeService()(mockComponents as DeChatComponents);
  });

  afterEach(() => {
    pexService.stop();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('should subscribe to the PEX topic on initialization', () => {
    expect(mockPubsub.subscribe).toHaveBeenCalledWith(PEX_TOPIC);
    expect(mockPubsub.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
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
    mockRegistry.getCandidates.mockReturnValue([{ peerId: 'peer-B', addresses: ['/ip4/192.168.1.1/tcp/8000'] }]);
    mockNode.getConnections.mockReturnValue([{ remotePeer: { toString: () => 'active-peer' } }]);

    await pexService.initiatePeerExchange();
    await vi.advanceTimersByTimeAsync(35_000);

    expect(mockPubsub.publish).toHaveBeenCalledWith(PEX_TOPIC, expect.any(Uint8Array));
  });

  it('should penalize peers for sending invalid PEX messages', () => {
    const fakeEvent = new CustomEvent('message', {
      detail: {
        topic: PEX_TOPIC,
        data: new TextEncoder().encode(
          JSON.stringify({ from: 'malicious-peer', type: 'INVALID', peers: 'not-an-array' }),
        ),
      },
    });

    const listener = mockPubsub.addEventListener.mock.calls.find((c: any) => c[0] === 'message')[1];
    listener(fakeEvent);

    expect(mockScorer.penalize).toHaveBeenCalledWith('malicious-peer', 5);
  });
});
