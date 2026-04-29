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
import { PeerAuthenticator } from './networking/PeerAuthenticator';
import { PeerDiscoveryManager } from './networking/PeerDiscoveryManager';
import { PeerExchangeService } from './networking/PeerExchangeService';
import { PeerRegistry } from './networking/PeerRegistry';
import { SimplePeerScorer } from './networking/SimplePeerScorer';
import { ReplicaStoreInterface } from './replica-store/ReplicaStoreInterface';

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
  peerAuthenticator: PeerAuthenticator;
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
