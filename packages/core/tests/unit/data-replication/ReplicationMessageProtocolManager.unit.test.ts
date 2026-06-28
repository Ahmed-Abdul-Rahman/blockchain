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
      onReceive: vi.fn(),
      // FIX: The interface expects 'send', not 'sendMessage'
      send: vi.fn().mockResolvedValue(undefined),
    };
    mockBroadcastPropagation = {
      subscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    };
    mockTransportSelector = {
      select: vi.fn().mockReturnValue('direct'), // Fixed mock method name as well
    };
    mockDelegate = {
      onPeerAnnounced: vi.fn().mockResolvedValue(undefined),
      onPeerRequested: vi.fn().mockResolvedValue({ found: false, closestPeers: [] }),
      onPeerDeliveredContent: vi.fn().mockResolvedValue(undefined),
      onPeerReportedError: vi.fn().mockResolvedValue(undefined),
    };

    mockComponents = {
      libp2p: { peerId: { toString: () => 'self-peer-id' } } as any,
      config: {
        strategies: {
          // Fixed path based on error trace
          replication: {
            kReplicaCount: 3,
            maxAttempts: 3,
            baseDelayMs: 200,
            topic: '/test/v1/topic/replication-protocol',
            protocol: '/test/v1/protocol/replication-protocol',
          },
        },
      } as any,
      strategies: {
        direct: mockDirectStreamPropagation,
        broadcast: mockBroadcastPropagation,
      } as any,
    };

    protocolManager = new ReplicationMessageProtocolManager(mockComponents as DeChatComponents);
    protocolManager.setDelegate(mockDelegate);
    // Inject transport selector for the test
    (protocolManager as any).transportSelector = mockTransportSelector;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes replication_request to the delegate and sends back content if found', async () => {
    mockDelegate.onPeerRequested.mockResolvedValueOnce({ found: true, data: new Uint8Array([1, 2, 3]) });

    // FIX: Pass the properly formatted PropagatedMessage
    await (protocolManager as any).handleIncomingDirect(
      { payload: { type: 'replication_request', hash: 'hash-1' }, from: 'remote-peer' },
      { from: 'remote-peer' },
    );

    expect(mockDelegate.onPeerRequested).toHaveBeenCalledWith('hash-1', 'remote-peer');

    // FIX: Expect 'send' instead of 'sendMessage'
    expect(mockDirectStreamPropagation.send).toHaveBeenCalledWith(
      'remote-peer',
      expect.any(String), // protocol string
      expect.objectContaining({ payload: expect.objectContaining({ type: 'replication_content' }) }),
    );
  });

  it('resolves pending explicit requests intercepting passive routing', async () => {
    const requestPromise = protocolManager.requestDataAndAwaitResponse('hash-2', 'target-peer');

    // FIX: Wrap inside 'payload' to match PropagatedMessage
    await (protocolManager as any).handleIncomingDirect(
      {
        payload: { type: 'replication_content', hash: 'hash-2', replicationContent: new Uint8Array([9, 9]) },
        from: 'target-peer',
      },
      { from: 'target-peer' },
    );

    const response = await requestPromise;
    expect(response.type).toBe('replication_content');
  });
});
