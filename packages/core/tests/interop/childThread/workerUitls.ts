import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Libp2p } from 'libp2p';
import { threadId, workerData } from 'worker_threads';
import { GossipSubPropagation } from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import { DirectStreamPropagation } from '../../../src/data-propagation/direct/DirectStreamPropagation';
import { Sha256ContentHashStrategy } from '../../../src/data-replication/content-hash/Sha256ContentHashStrategy';
import { KReplicaContentHashReplication } from '../../../src/data-replication/KReplicaContentHashReplication';
import { InflightRequestTracker } from '../../../src/data-replication/replication-protocol/InflightRequestTracker';
import { ReplicationMessageProtocolManager } from '../../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { TransportSelector } from '../../../src/data-replication/replication-protocol/TransportSelector';
import { getGenericDataSerailizer } from '../../../src/data-replication/serializers';
import { NoopGossipMetrics } from '../../../src/metrics';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { SimplePeerScorer } from '../../../src/networking/SimplePeerScorer';
import { createNode } from '../../../src/node';
import { InMemoryReplicaStore } from '../../../src/replica-store/InMemoryReplicationStorage';
import { WorkerData } from '../types';

export const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return -1;
  const i = Math.floor((p / 100) * (xs.length - 1));
  return xs[i];
};

export const configureNode = async (
  onBoardingPeerTime: number,
): Promise<{
  node: Libp2p;
  nodePubsub: GossipSub;
  pexService: PeerExchangeService;
  scorer: SimplePeerScorer;
  broadcastProp: GossipSubPropagation;
  directStream: DirectStreamPropagation;
  replicaStore: InMemoryReplicaStore;
  dataReplication: KReplicaContentHashReplication;
  nodeCleanUp: () => void;
}> => {
  const args = workerData as WorkerData;
  const { index, nodeSeed, networkId } = args;

  const { node, pexService, nodeCleanUp, scorer } = await createNode(networkId, nodeSeed, {
    mdns: true,
    listenTcp: ['/ip4/127.0.0.1/tcp/0'],
    onBoardingPeerTime,
  });

  const nodePubsub = node.services.pubsub as GossipSub;

  const broadcastProp = new GossipSubPropagation(node, new NoopGossipMetrics());

  const directStream = new DirectStreamPropagation(node);

  const contentHashing = new Sha256ContentHashStrategy();

  const serializer = getGenericDataSerailizer();

  const replicaStore = new InMemoryReplicaStore(serializer);

  const inflight = new InflightRequestTracker();

  const transportSelector = new TransportSelector();

  const replicationManager = new ReplicationMessageProtocolManager(node.peerId, {
    broadcast: broadcastProp,
    direct: directStream,
    inflightTracker: inflight,
    transportSelector,
    storage: replicaStore,
    hashStrategy: contentHashing,
  });

  const dataReplication = new KReplicaContentHashReplication(
    node.peerId.toString(),
    () => pexService.peerRegistry.getPeers(),
    contentHashing,
    replicaStore,
    serializer,
    replicationManager,
    3,
  );

  replicationManager.setShouldReplicateFn((contentHash, _fromPeer) =>
    dataReplication.shouldReplicate(contentHash, _fromPeer),
  );

  console.log('Wroker thread: ', threadId, 'and index: ', index, ' started with peerId: ', node.peerId);

  return {
    node,
    nodePubsub,
    pexService,
    scorer,
    broadcastProp,
    directStream,
    replicaStore,
    dataReplication,
    nodeCleanUp,
  };
};
