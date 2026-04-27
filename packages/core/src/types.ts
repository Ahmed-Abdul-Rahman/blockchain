import { Libp2p } from '@libp2p/interface';
import { DeChatConfig } from './config/types';
import { BroadcastPropagationInterface } from './data-propagation/broadcast/BroadcastPropagationInterface';
import { DirectPropagationInterface } from './data-propagation/direct/DirectPropagationInterface';
import { ContentHashStrategyInterface } from './data-replication/content-hash/types';
import { DataReplicationInterface } from './data-replication/DataReplicationInterface';
import { ReplicationProtocolInterface } from './data-replication/replication-protocol/ReplicationProtocolInterface';
import { DataSerializer } from './data-replication/types';
import { AuthMetrics, DialQueueMetrics, PeerExchangeServiceMetrics, PeerRegistryMetrics } from './metrics';
import { GossipSubPropagationMetrics } from './metrics/interfaces/GossipSubPropagationMetrics';
import { DialQueue } from './networking/DialQueue';
import { PeerDiscoveryManager } from './networking/PeerDiscoveryManager';
import { PeerExchangeService } from './networking/PeerExchangeService';
import { PeerRegistry } from './networking/PeerRegistry';
import { SimplePeerScorer } from './networking/SimplePeerScorer';
import { ReplicaStoreInterface } from './replica-store/ReplicaStoreInterface';

export interface NodeOptions {
  /** Enable Multicast DNS */
  mdns?: boolean;

  /** override listen multiaddrs */
  listenTcp?: string[];

  /** override bootstrap multiaddrs */
  bootstrap?: string[];

  /** Initial bootstrap peers to be loaded */
  peerSeeds?: { peerId: string; addresses: string[] }[];

  /** Time to interact with a newly discovered peer and on board it to the network */
  onBoardingPeerTime?: number;

  /** Maximum direct peer connections to be maintained */
  maxConnections?: number;

  /** Enable metrics for node behaviour analysis */
  enableMetrics?: boolean;
}

export interface NodeComponents {
  node: Libp2p;
  scorer: SimplePeerScorer;
  pexService: PeerExchangeService;
  nodeCleanUp: () => void;
}

export interface DeChatStrategies {
  broadcast?: DeChatFactory<BroadcastPropagationInterface>;
  direct?: DeChatFactory<DirectPropagationInterface>;
  replicaStore?: DeChatFactory<ReplicaStoreInterface>;
  contentHasher?: DeChatFactory<ContentHashStrategyInterface>;
  replicationProtocol?: DeChatFactory<ReplicationProtocolInterface>;
  dataReplication?: DeChatFactory<DataReplicationInterface>;
}

export interface DeChatMetrics {
  dialQueue: DialQueueMetrics;
  pexService: PeerExchangeServiceMetrics;
  peerRegistry: PeerRegistryMetrics;
  authMetrics: AuthMetrics;
  gossipSubPropMetrics: GossipSubPropagationMetrics;
}

export interface DeChatComponents {
  libp2p: Libp2p;
  config: DeChatConfig;
  scorer: SimplePeerScorer;
  peerRegistry: PeerRegistry;
  dialQueue: DialQueue;
  pexService: PeerExchangeService;
  peerDiscovery: PeerDiscoveryManager;
  serializer: DataSerializer;
  metrics: DeChatMetrics;
  strategies: {
    broadcast?: BroadcastPropagationInterface;
    direct?: DirectPropagationInterface;
    replicaStore?: ReplicaStoreInterface;
    contentHasher?: ContentHashStrategyInterface;
    dataReplication?: DataReplicationInterface;
    replicationProtocol?: ReplicationProtocolInterface;
  };
}

export type DeChatFactory<T> = (components: DeChatComponents) => T;
