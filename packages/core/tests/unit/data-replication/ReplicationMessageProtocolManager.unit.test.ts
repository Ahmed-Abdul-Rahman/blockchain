/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplicationMessageProtocolManager } from '../../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { TransportSelector } from '../../../src/data-replication/replication-protocol/TransportSelector';

describe('ReplicationMessageProtocolManager', () => {
  let manager: ReplicationMessageProtocolManager;
  let mockBroadcast: any;
  let mockDirect: any;
  let mockDelegate: any;

  beforeEach(() => {
    mockBroadcast = {
      subscribe: vi.fn(),
      publish: vi.fn(),
      unsubscribe: vi.fn(),
    };

    mockDirect = {
      onReceive: vi.fn(),
      send: vi.fn(),
    };

    mockDelegate = {
      onPeerAnnounced: vi.fn(),
      onPeerRequested: vi.fn(),
      onPeerDeliveredContent: vi.fn(),
      onPeerReportedError: vi.fn(),
    };

    manager = new ReplicationMessageProtocolManager('selfPeerId' as any, {
      broadcast: mockBroadcast,
      direct: mockDirect,
      transportSelector: new TransportSelector(),
    });

    manager.setDelegate(mockDelegate);
  });

  it('routes replication_request to the delegate and sends back content if found', async () => {
    const requestMsg = {
      id: 'hash1',
      from: 'peerX',
      payload: { type: 'replication_request', hash: 'hash1' },
    };

    // Mock the delegate finding the data
    mockDelegate.onPeerRequested.mockResolvedValue({
      found: true,
      data: new Uint8Array([1, 2, 3]),
    });

    await manager.handleRequest(requestMsg as any, { from: 'peerX' as any, receivedAt: Date.now() });

    expect(mockDelegate.onPeerRequested).toHaveBeenCalledWith('hash1', 'peerX');
    expect(mockDirect.send).toHaveBeenCalledWith(
      'peerX',
      manager.protocol,
      expect.objectContaining({
        payload: expect.objectContaining({ type: 'replication_content' }),
      }),
    );
  });

  it('resolves pending explicit requests intercepting passive routing', async () => {
    const hash = 'hash-target';
    const targetPeerId = 'peerY';

    // Fire the request (this sets up the pending Request map)
    const requestPromise = manager.requestDataAndAwaitResponse(hash, targetPeerId);

    // Simulate receiving the content back via the direct channel
    const contentMsg = {
      id: hash,
      from: targetPeerId,
      payload: { type: 'replication_content', hash, replicationContent: [9, 9] },
    };

    await manager.handleContent(contentMsg as any, { from: targetPeerId as any, receivedAt: Date.now() });

    const result = await requestPromise;

    // Delegate should NOT be notified because it was an explicit request handled by the Promise
    expect(mockDelegate.onPeerDeliveredContent).not.toHaveBeenCalled();
    expect(result.type).toBe('replication_content');
  });
});
