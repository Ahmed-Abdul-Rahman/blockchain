import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Libp2p } from 'libp2p';
import { threadId, workerData } from 'worker_threads';
import {
  GossipSubPropagation,
  gossipSubPropagation,
} from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import {
  DirectStreamPropagation,
  directStreamPropagation,
} from '../../../src/data-propagation/direct/DirectStreamPropagation';
import { contentHashStrategy } from '../../../src/data-replication/content-hash/Sha256ContentHashStrategy';
import { ContentHashStrategy } from '../../../src/data-replication/content-hash/types';
import {
  KReplicaContentHashReplication,
  kReplicaContentHashReplication,
} from '../../../src/data-replication/KReplicaContentHashReplication';
import { replicationMessageProtocolManager } from '../../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { SimplePeerScorer } from '../../../src/networking/SimplePeerScorer';
import { createNode } from '../../../src/node';
import { InMemoryReplicaStore } from '../../../src/replica-store/InMemoryReplicaStore';
import { replicaStore } from '../../../src/replica-store/ReplicaStoreInterface';
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
  contentHasher: ContentHashStrategy;
  dataReplication: KReplicaContentHashReplication;
  nodeCleanUp: () => Promise<void>; // Updated to match the async stop() signature
}> => {
  const args = workerData as WorkerData;
  const { index, nodeSeed, networkId } = args;

  // Initialize using the new Config and Pluggable Strategy Factory
  const engine = await createNode(
    networkId,
    nodeSeed,
    {
      // Map old config to the new nested DeChatConfig structure
      network: {
        listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
        bootstrapPeers: [],
        maxConnections: 150,
        minConnections: 8,
        maxIncomingPendingConnections: 20,
      },
      discovery: { enableMdns: true, onBoardingPeerTime },
    },
    {
      broadcast: gossipSubPropagation(),
      direct: directStreamPropagation(),
      replicaStore: replicaStore('IN_MEMORY'),
      contentHasher: contentHashStrategy(),
      replicationProtocol: replicationMessageProtocolManager(),
      dataReplication: kReplicaContentHashReplication(),
    },
  );

  const { components, stop } = engine;
  const node = components.libp2p;

  console.log('Worker thread: ', threadId, 'and index: ', index, ' started with peerId: ', node.peerId);

  // Destructure components to return the exact footprint the test runner expects
  return {
    node,
    nodePubsub: node.services.pubsub as GossipSub,
    pexService: components.pexService,
    scorer: components.scorer,
    broadcastProp: components.strategies.broadcast as GossipSubPropagation,
    directStream: components.strategies.direct as DirectStreamPropagation,
    replicaStore: components.strategies.replicaStore as InMemoryReplicaStore,
    contentHasher: components.strategies.contentHasher as ContentHashStrategy,
    dataReplication: components.strategies.dataReplication as KReplicaContentHashReplication,
    nodeCleanUp: stop,
  };
};
