/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { NoopPeerExchangeMetrics } from '../../../src/metrics';
import { PeerExchangeService, peerExchangeService } from '../../../src/networking/PeerExchangeService';
import { createCborWireSerializer } from '../../../src/shared/serialization';
import { DeChatComponents } from '../../../src/types';

describe('PeerExchangeService', () => {
  let mockComponents: Partial<DeChatComponents>;
  let pexService: PeerExchangeService;
  let mockPubsub: any;
  let mockNode: any;
  let mockDialQ: any;
  let mockScorer: any;
  let mockRegistry: any;
  const pexProtocol = '/deChat/core/peer-exchange-protocol/1.0.0';
  const pexTopic = '/deChat/core/peer-exchange-topic/1.0.0';

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
      getRemotePeerConnections: vi.fn().mockReturnValue([]),
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
      serializer: createCborWireSerializer(),
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
    expect(mockPubsub.subscribe).toHaveBeenCalledWith(pexTopic);
    expect(mockPubsub.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockNode.handle).toHaveBeenCalledWith(pexProtocol, expect.any(Function));
  });

  it('enqueues a peer with addresses and skips a second enqueue during cooldown', () => {
    const peersWithAddrs = [{ peerId: 'peer-A', addresses: ['/ip4/127.0.0.1/tcp/4001/p2p/peer-A'] }];
    pexService.enqueueDial(peersWithAddrs);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith(peersWithAddrs);

    mockDialQ.enqueue.mockClear();
    pexService.enqueueDial(peersWithAddrs);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);
  });

  it('re-enqueues an unconnected peer after the dial cooldown so gossip can retry failed dials', () => {
    const peersWithAddrs = [{ peerId: 'peer-A', addresses: ['/ip4/127.0.0.1/tcp/4001/p2p/peer-A'] }];
    pexService.enqueueDial(peersWithAddrs);
    mockDialQ.enqueue.mockClear();

    vi.advanceTimersByTime(DECHAT_DEFAULTS.pexService.dialEnqueueCooldownMs - 1);
    pexService.enqueueDial(peersWithAddrs);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);

    mockDialQ.enqueue.mockClear();
    vi.advanceTimersByTime(1);
    pexService.enqueueDial(peersWithAddrs);

    expect(mockDialQ.enqueue).toHaveBeenCalledWith(peersWithAddrs);
  });

  it('does not enqueue this node', () => {
    pexService.enqueueDial([{ peerId: 'self-peer-id', addresses: ['/ip4/127.0.0.1/tcp/4001/p2p/self-peer-id'] }]);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);
  });

  it('does not enqueue a peer that already has an open connection', () => {
    mockDialQ.getRemotePeerConnections.mockReturnValue([{ status: 'open' }]);
    pexService.enqueueDial([{ peerId: 'peer-A', addresses: ['/ip4/127.0.0.1/tcp/4001/p2p/peer-A'] }]);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);
  });

  it('does not re-enqueue after cooldown when the peer now has an open connection', () => {
    const peersWithAddrs = [{ peerId: 'peer-A', addresses: ['/ip4/127.0.0.1/tcp/4001/p2p/peer-A'] }];
    pexService.enqueueDial(peersWithAddrs);
    mockDialQ.enqueue.mockClear();
    mockDialQ.getRemotePeerConnections.mockReturnValue([{ status: 'open' }]);

    vi.advanceTimersByTime(DECHAT_DEFAULTS.pexService.dialEnqueueCooldownMs);
    pexService.enqueueDial(peersWithAddrs);

    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);
  });

  it('does not treat empty-address peers as seen, so a later advertisement with addrs can enqueue', () => {
    pexService.enqueueDial([{ peerId: 'peer-B', addresses: [] }]);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([]);

    mockDialQ.enqueue.mockClear();
    const withAddrs = [{ peerId: 'peer-B', addresses: ['/ip4/127.0.0.1/tcp/4002/p2p/peer-B'] }];
    pexService.enqueueDial(withAddrs);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith(withAddrs);
  });

  it('should trigger gossip loop and publish known peers', async () => {
    mockRegistry.getCandidates.mockReturnValue([{ peerId: 'peer-B', addresses: ['/ip4/192.168.1.1/tcp/8000'] }]);
    mockNode.getConnections.mockReturnValue([{ remotePeer: { toString: () => 'active-peer' } }]);

    await pexService.initiatePeerExchange();
    await vi.advanceTimersByTimeAsync(35_000);

    expect(mockPubsub.publish).toHaveBeenCalledWith(pexTopic, expect.any(Uint8Array));
  });

  it('should penalize peers for sending invalid PEX messages', () => {
    const fakeEvent = new CustomEvent('message', {
      detail: {
        topic: pexTopic,
        data: createCborWireSerializer().serialize({
          from: 'malicious-peer',
          type: 'INVALID',
          peers: 'not-an-array',
        }),
      },
    });

    const listener = mockPubsub.addEventListener.mock.calls.find((c: any) => c[0] === 'message')[1];
    listener(fakeEvent);

    expect(mockScorer.penalize).toHaveBeenCalledWith('malicious-peer', 5);
  });

  it('enqueues the gossip origin peer so listeners can dial advertised listen addrs', () => {
    const origin = {
      peerId: 'origin-peer',
      addresses: ['/ip4/127.0.0.1/tcp/4001/p2p/origin-peer'],
    };
    const fakeEvent = new CustomEvent('message', {
      detail: {
        topic: pexTopic,
        data: createCborWireSerializer().serialize({
          from: 'origin-peer',
          type: 'PEX_GOSSIP',
          peers: [],
          ts: Date.now(),
          originPeerInfo: origin,
        }),
      },
    });

    const listener = mockPubsub.addEventListener.mock.calls.find((c: any) => c[0] === 'message')[1];
    listener(fakeEvent);

    expect(mockRegistry.upsert).toHaveBeenCalledWith(origin);
    expect(mockDialQ.enqueue).toHaveBeenCalledWith([origin]);
  });
});
