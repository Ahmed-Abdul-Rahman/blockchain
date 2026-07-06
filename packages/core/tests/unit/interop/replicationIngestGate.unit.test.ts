import { describe, expect, it, vi } from 'vitest';
import type { DataReplicationInterface } from '../../../src/data-replication/DataReplicationInterface';
import type { ReplicationEngineDelegate } from '../../../src/data-replication/replication-protocol/ReplicationEngineDelegateInterface';
import { installReplicationProtocolIngestGate } from '../../interop/childThread/replicationIngestGate';

const createMockDelegate = (): ReplicationEngineDelegate => ({
  onPeerAnnounced: vi.fn().mockResolvedValue(undefined),
  onPeerRequested: vi.fn().mockResolvedValue({ found: false, closestPeers: [] }),
  onPeerDeliveredContent: vi.fn().mockResolvedValue(undefined),
  onPeerReportedError: vi.fn().mockResolvedValue(undefined),
});

describe('installReplicationProtocolIngestGate', () => {
  it('blocks passive announce and content ingest while the gate is closed', async () => {
    const inner = createMockDelegate();
    let wrapped: ReplicationEngineDelegate | undefined;
    const dataReplication = {
      replicationProtocol: {
        setDelegate: (delegate: ReplicationEngineDelegate) => {
          wrapped = delegate;
        },
      },
    } as unknown as DataReplicationInterface;

    Object.assign(dataReplication, inner);

    const ingestEnabled = false;
    installReplicationProtocolIngestGate(dataReplication, () => ingestEnabled);
    expect(wrapped).toBeDefined();

    const handleAnnounce = vi.fn().mockResolvedValue(undefined);
    await wrapped!.onPeerAnnounced('hash-a', 'peer-1', handleAnnounce);
    await wrapped!.onPeerDeliveredContent('hash-b', new Uint8Array([1]), 'peer-2');
    await wrapped!.onPeerReportedError('hash-c', 'not_found', [], 'peer-3');

    expect(inner.onPeerAnnounced).not.toHaveBeenCalled();
    expect(handleAnnounce).not.toHaveBeenCalled();
    expect(inner.onPeerDeliveredContent).not.toHaveBeenCalled();
    expect(inner.onPeerReportedError).not.toHaveBeenCalled();
  });

  it('forwards passive ingest once the gate opens but always serves peer requests', async () => {
    const inner = createMockDelegate();
    let wrapped: ReplicationEngineDelegate | undefined;
    const dataReplication = {
      replicationProtocol: {
        setDelegate: (delegate: ReplicationEngineDelegate) => {
          wrapped = delegate;
        },
      },
    } as unknown as DataReplicationInterface;

    Object.assign(dataReplication, inner);

    const ingestEnabled = true;
    installReplicationProtocolIngestGate(dataReplication, () => ingestEnabled);

    const handleAnnounce = vi.fn().mockResolvedValue(undefined);
    await wrapped!.onPeerAnnounced('hash-a', 'peer-1', handleAnnounce);
    await wrapped!.onPeerRequested('hash-d', 'peer-4');

    expect(inner.onPeerAnnounced).toHaveBeenCalledWith('hash-a', 'peer-1', handleAnnounce);
    expect(inner.onPeerRequested).toHaveBeenCalledWith('hash-d', 'peer-4');
  });
});
