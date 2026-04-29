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
import { ContentHashStrategyInterface } from '../../../src/data-replication/content-hash/types';
import { DataReplicationInterface } from '../../../src/data-replication/DataReplicationInterface';
import { kReplicaContentHashReplication } from '../../../src/data-replication/KReplicaContentHashReplication';
import { replicationMessageProtocolManager } from '../../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { SimplePeerScorer } from '../../../src/networking/SimplePeerScorer';
import { createNode } from '../../../src/node';
import { ReplicaStoreInterface, replicaStore } from '../../../src/replica-store/ReplicaStoreInterface';
import { DeChatStrategies } from '../../../src/types';
import { WorkerData } from '../types';

export const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return -1;
  const i = Math.floor((p / 100) * (xs.length - 1));
  return xs[i];
};

export const configureNode = async (
  onBoardingPeerTime: number,
): Promise<{
  start: () => Promise<void>;
  node: Libp2p;
  nodePubsub: GossipSub;
  pexService: PeerExchangeService;
  scorer: SimplePeerScorer;
  broadcastProp: GossipSubPropagation;
  directStream: DirectStreamPropagation;
  replicaStore: ReplicaStoreInterface | undefined;
  contentHasher: ContentHashStrategyInterface | undefined;
  dataReplication: DataReplicationInterface | undefined;
  nodeCleanUp: () => Promise<void>;
}> => {
  const args = workerData as WorkerData;
  const { index, nodeSeed, networkId, testType } = args;

  let strategies: DeChatStrategies = {
    broadcast: gossipSubPropagation(),
    direct: directStreamPropagation(),
  };

  if (testType && testType === 'REPLICATION') {
    strategies = {
      ...strategies,
      replicaStore: replicaStore('IN_MEMORY'),
      contentHasher: contentHashStrategy(),
      replicationProtocol: replicationMessageProtocolManager(),
      dataReplication: kReplicaContentHashReplication(),
    };
  }

  const engine = await createNode(
    networkId,
    nodeSeed,
    {
      network: {
        listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
        bootstrapPeers: [],
        maxConnections: 150,
        minConnections: 8,
        maxIncomingPendingConnections: 20,
      },
      discovery: { enableMdns: true, onBoardingPeerTime },
    },
    strategies,
  );

  const { components, stop, start } = engine;
  const node = components.libp2p;

  console.log('Worker thread: ', threadId, 'and index: ', index, ' started with peerId: ', node.peerId);

  return {
    start,
    node,
    nodePubsub: node.services.pubsub as GossipSub,
    pexService: components.pexService,
    scorer: components.scorer,
    broadcastProp: components.strategies.broadcast as GossipSubPropagation,
    directStream: components.strategies.direct as DirectStreamPropagation,
    replicaStore: components.strategies.replicaStore,
    contentHasher: components.strategies.contentHasher,
    dataReplication: components.strategies.dataReplication,
    nodeCleanUp: stop,
  };
};
