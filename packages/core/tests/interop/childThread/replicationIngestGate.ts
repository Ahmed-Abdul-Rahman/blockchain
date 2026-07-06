import type { DataReplicationInterface } from '../../../src/data-replication/DataReplicationInterface';
import type { ReplicationEngineDelegate } from '../../../src/data-replication/replication-protocol/ReplicationEngineDelegateInterface';

/**
 * Wraps the replication-protocol delegate so passive announce/content ingest can be
 * deferred independently of anti-entropy's explicit `requestMissingData` fetches.
 */
export const installReplicationProtocolIngestGate = (
  dataReplication: DataReplicationInterface,
  isIngestEnabled: () => boolean,
): void => {
  const delegate = dataReplication as unknown as ReplicationEngineDelegate;

  dataReplication.replicationProtocol.setDelegate({
    onPeerAnnounced: async (hash, peerId, handleAnnounce) => {
      if (!isIngestEnabled()) return;
      return delegate.onPeerAnnounced(hash, peerId, handleAnnounce);
    },
    onPeerRequested: (hash, fromPeerId) => delegate.onPeerRequested(hash, fromPeerId),
    onPeerDeliveredContent: async (hash, data, peerId) => {
      if (!isIngestEnabled()) return;
      return delegate.onPeerDeliveredContent(hash, data, peerId);
    },
    onPeerReportedError: async (hash, reason, closestPeers, peerId) => {
      if (!isIngestEnabled()) return;
      return delegate.onPeerReportedError(hash, reason, closestPeers, peerId);
    },
  });
};
