import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Libp2p } from 'libp2p';
import { threadId, workerData } from 'worker_threads';
import { GossipSubPropagation } from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import { DirectStreamPropagation } from '../../../src/data-propagation/direct/DirectStreamPropagation';
import { Sha256ContentHashStrategy } from '../../../src/data-replication/content-hash/Sha256ContentHashStrategy';
import { KReplicaContentHashReplication } from '../../../src/data-replication/KReplicaContentHashReplication';
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
  directStreamProtocol: string,
  dataReplicaCount: number,
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

  const directStream = new DirectStreamPropagation(node, directStreamProtocol);

  const contentHashing = new Sha256ContentHashStrategy();

  const serializer = getGenericDataSerailizer();

  const replicaStore = new InMemoryReplicaStore(serializer);

  const dataReplication = new KReplicaContentHashReplication(
    node.peerId,
    contentHashing,
    replicaStore,
    serializer,
    directStream,
    scorer,
    dataReplicaCount,
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
