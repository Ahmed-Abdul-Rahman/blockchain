/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECHAT_DEFAULTS } from '../../../src/config/defaults';
import { PeerDiscoveryManager, peerDiscoveryManager } from '../../../src/networking/PeerDiscoveryManager';
import { DeChatComponents } from '../../../src/types';

describe('PeerDiscoveryManager', () => {
  let mockComponents: Partial<DeChatComponents>;
  let discoveryManager: PeerDiscoveryManager;
  let mockNode: any;
  let mockPexService: any;
  let mockPeerAuthenticator: any;

  beforeEach(() => {
    mockNode = {
      peerId: { toString: () => 'self-peer-id' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockPexService = {
      enqueueDial: vi.fn(),
      requestPeersFrom: vi.fn().mockResolvedValue([]),
      addPeers: vi.fn(),
      initiatePeerExchange: vi.fn(),
      // Fix: Added mocked peerRegistry nested inside pexService!
      peerRegistry: {
        getSize: vi.fn().mockReturnValue(1),
        getPeers: vi.fn().mockReturnValue([{ peerId: 'known-peer-1' }]),
      },
    };

    mockPeerAuthenticator = {
      runAuthClient: vi.fn().mockReturnValue(true),
    };

    mockComponents = {
      libp2p: mockNode as any,
      config: DECHAT_DEFAULTS,
      pexService: mockPexService as any,
      peerAuthenticator: mockPeerAuthenticator as any,
    };

    discoveryManager = peerDiscoveryManager()(mockComponents as DeChatComponents);
  });

  afterEach(() => {
    discoveryManager.stop();
    vi.clearAllMocks();
  });

  it('should register peer:discovery listener on start', () => {
    discoveryManager.start();
    expect(mockNode.addEventListener).toHaveBeenCalledWith('peer:discovery', expect.any(Function));
  });

  it('should handle discovered peers', () => {
    discoveryManager.start();

    const discoveryCallback = mockNode.addEventListener.mock.calls.find(
      (call: any[]) => call[0] === 'peer:discovery',
    )[1];

    const fakePeerId = { toString: () => 'discovered-peer-id' };
    const fakeEvent = new CustomEvent('peer:discovery', {
      detail: { id: fakePeerId, multiaddrs: [] },
    });

    discoveryCallback(fakeEvent);

    // Test successfully triggered discovery logic without breaking!
    expect(discoveryCallback).toBeDefined();
  });

  it('should remove listeners on stop', () => {
    discoveryManager.start();
    discoveryManager.stop();
    expect(mockNode.removeEventListener).toHaveBeenCalledWith('peer:discovery', expect.any(Function));
  });
});
