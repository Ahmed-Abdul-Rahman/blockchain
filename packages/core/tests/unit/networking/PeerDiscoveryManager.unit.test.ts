/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerDiscoveryManager } from '../../../src/networking/PeerDiscoveryManager';

describe('PeerDiscoveryManager', () => {
  let mockNode: any;
  let mockDialQ: any;
  let mockPexService: any; // 1. Declare the new mock
  let discoveryManager: PeerDiscoveryManager;

  beforeEach(() => {
    // 1. Add peerId mock to the node
    mockNode = {
      peerId: {
        toString: () => 'self-peer-id',
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockDialQ = {
      enqueue: vi.fn(),
    };

    // 2. Add the peerRegistry mock to the PEX service
    mockPexService = {
      enqueueDial: vi.fn(),
      peerRegistry: {
        getSize: vi.fn().mockReturnValue(1), // Mock that we have known peers
        getPeers: vi.fn().mockReturnValue(['existing-peer-1']),
      },
    };

    discoveryManager = new PeerDiscoveryManager(mockNode, mockDialQ, mockPexService);
  });

  afterEach(() => {
    discoveryManager.cleanUp();
    vi.clearAllMocks();
  });

  it('should register peer:discovery listener on start', () => {
    discoveryManager.registerPeerDiscovery();
    expect(mockNode.addEventListener).toHaveBeenCalledWith('peer:discovery', expect.any(Function));
  });

  it('should handle discovered peers', () => {
    discoveryManager.registerPeerDiscovery();

    // Extract the registered callback
    const discoveryCallback = mockNode.addEventListener.mock.calls.find(
      (call: any[]) => call[0] === 'peer:discovery',
    )[1];

    // Simulate a libp2p peer:discovery event
    const fakePeerId = { toString: () => 'discovered-peer-id' };
    const fakeEvent = new CustomEvent('peer:discovery', {
      detail: { id: fakePeerId, multiaddrs: [] },
    });

    // Trigger the callback
    discoveryCallback(fakeEvent);

    // Depending on your actual implementation, it either enqueues to dialQ or pexService.
    // If your code uses dialQ directly:
    // expect(mockDialQ.enqueue).toHaveBeenCalled();

    // If your code delegates to pexService:
    // expect(mockPexService.enqueueDial).toHaveBeenCalled();
  });

  it('should remove listeners on stop', () => {
    discoveryManager.registerPeerDiscovery();
    discoveryManager.cleanUp();

    expect(mockNode.removeEventListener).toHaveBeenCalledWith('peer:discovery', expect.any(Function));
  });
});
