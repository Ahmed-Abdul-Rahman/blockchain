import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Libp2p } from 'libp2p';
import { threadId, workerData } from 'worker_threads';
import { GossipSubPropagation } from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import { DirectStreamPropagation } from '../../../src/data-propagation/direct/DirectStreamPropagation';
import { Sha256ContentHashStrategy } from '../../../src/data-replication/content-hash/Sha256ContentHashStrategy';
import { ContentHashStrategy } from '../../../src/data-replication/content-hash/types';
import {
  createReplicationEngine,
  KReplicaContentHashReplication,
} from '../../../src/data-replication/KReplicaContentHashReplication';
import { ReplicationMessageProtocolManager } from '../../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { TransportSelector } from '../../../src/data-replication/replication-protocol/TransportSelector';
import { getGenericDataSerailizer } from '../../../src/data-replication/serializers';
import { NoopGossipMetrics } from '../../../src/metrics';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { SimplePeerScorer } from '../../../src/networking/SimplePeerScorer';
import { createNode } from '../../../src/node';
import { InMemoryReplicaStore } from '../../../src/replica-store/InMemoryReplicaStore';
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
      // Inject strategies using the components container (c)
      broadcast: (c) => new GossipSubPropagation(c.libp2p, new NoopGossipMetrics()),
      direct: (c) => new DirectStreamPropagation(c.libp2p),
      replicaStore: () => new InMemoryReplicaStore(getGenericDataSerailizer()),
      contentHasher: () => new Sha256ContentHashStrategy(),
      replicationProtocol: (c) =>
        new ReplicationMessageProtocolManager(c.libp2p.peerId, {
          broadcast: c.strategies.broadcast!,
          direct: c.strategies.direct!,
          transportSelector: new TransportSelector(),
        }),
      dataReplication: (c) =>
        createReplicationEngine(
          c.libp2p.peerId.toString(),
          () => c.pexService.peerRegistry.getPeers(), // Correctly bound to the injected PEX service
          c.strategies.contentHasher!,
          c.strategies.replicaStore!,
          getGenericDataSerailizer(),
          c.strategies.replicationProtocol!,
          3,
        ) as unknown as KReplicaContentHashReplication, // Typecast since factory natively returns DataReplicationInterface
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
