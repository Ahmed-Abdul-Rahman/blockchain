/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplicationMessageProtocolManager } from '../../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { DeChatComponents } from '../../../src/types';

describe('ReplicationMessageProtocolManager', () => {
  let protocolManager: ReplicationMessageProtocolManager;
  let mockComponents: Partial<DeChatComponents>;

  let mockDirectStreamPropagation: any;
  let mockBroadcastPropagation: any;
  let mockTransportSelector: any;
  let mockDelegate: any;

  beforeEach(() => {
    mockDirectStreamPropagation = {
      // Fixed: Changed from registerHandler to onReceive
      onReceive: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockBroadcastPropagation = {
      subscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    };
    mockTransportSelector = {
      selectOptimalTransport: vi.fn().mockReturnValue('direct'),
    };
    mockDelegate = {
      onPeerAnnounced: vi.fn().mockResolvedValue(undefined),
      onPeerRequested: vi.fn().mockResolvedValue({ found: false, closestPeers: [] }),
      onPeerDeliveredContent: vi.fn().mockResolvedValue(undefined),
      onPeerReportedError: vi.fn().mockResolvedValue(undefined),
    };

    mockComponents = {
      libp2p: { peerId: { toString: () => 'self-peer-id' } } as any,
      strategies: {
        direct: mockDirectStreamPropagation,
        broadcast: mockBroadcastPropagation,
        transportSelector: mockTransportSelector,
      } as any,
    };

    protocolManager = new ReplicationMessageProtocolManager(mockComponents as DeChatComponents);
    protocolManager.setDelegate(mockDelegate);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes replication_request to the delegate and sends back content if found', async () => {
    mockDelegate.onPeerRequested.mockResolvedValueOnce({ found: true, data: new Uint8Array([1, 2, 3]) });

    await (protocolManager as any).handleIncomingDirect(
      { type: 'replication_request', contentHash: 'hash-1' },
      'remote-peer',
    );

    expect(mockDelegate.onPeerRequested).toHaveBeenCalledWith('hash-1', 'remote-peer');
    expect(mockDirectStreamPropagation.sendMessage).toHaveBeenCalledWith(
      'remote-peer',
      expect.objectContaining({ type: 'replication_content' }),
      expect.any(String), // protocol string
    );
  });

  it('resolves pending explicit requests intercepting passive routing', async () => {
    const requestPromise = protocolManager.requestDataAndAwaitResponse('hash-2', 'target-peer');

    await (protocolManager as any).handleIncomingDirect(
      { type: 'replication_content', contentHash: 'hash-2', replicationContent: [9, 9] },
      'target-peer',
    );

    const response = await requestPromise;
    expect(response.type).toBe('replication_content');
  });
});
