export { createBrowserNode } from './src/browser';
export { DECHAT_DEFAULTS, isConfigValid, resolveConfig } from './src/config/defaults';
export type { DeChatConfig } from './src/config/types';
export { AntiEntropyManager, antiEntropyManager } from './src/data-convergence/AntiEntropyManager';
export {
  AntiEntropyNetworkExchange,
  antiEntropyNetworkExchangeEngine,
} from './src/data-convergence/AntiEntropyNetworkExchange';
export { PrefixTrie, TrieNode } from './src/data-convergence/PrefixTrie';
export { TrieBackedReplicaStore } from './src/data-convergence/TrieBackedReplicaStore';
export { BroadcastPropagationInterface } from './src/data-propagation/broadcast/BroadcastPropagationInterface';
export { GossipSubPropagation } from './src/data-propagation/broadcast/GossipSubPropagation';
export { DirectPropagationInterface } from './src/data-propagation/direct/DirectPropagationInterface';
export { DirectStreamPropagation } from './src/data-propagation/direct/DirectStreamPropagation';
export type { PropagatedMessage, PropagationContext } from './src/data-propagation/types';
export { Sha256ContentHashStrategy } from './src/data-replication/content-hash/Sha256ContentHashStrategy';
export { ContentHashStrategyInterface } from './src/data-replication/content-hash/types';
export { DataReplicationInterface } from './src/data-replication/DataReplicationInterface';
export {
  KReplicaContentReplication as KReplicaContentHashReplication,
  kReplicaContentHashReplication,
} from './src/data-replication/KReplicaContentReplication';
export { ReplicationMessageProtocolManager } from './src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
export { ReplicationProtocolInterface } from './src/data-replication/replication-protocol/ReplicationProtocolInterface';
export { TransportSelector } from './src/data-replication/replication-protocol/TransportSelector';
export {
  TopicBasedContentReplication,
  topicBasedContentHashReplication,
} from './src/data-replication/TopicBasedContentReplication';
export type { ContentHash } from './src/data-replication/types';
export * from './src/metrics';
export { DialQueue, dialQueue } from './src/networking/DialQueue';
export { PeerAuthenticator, peerAuthenticator } from './src/networking/PeerAuthenticator';
export { PeerDiscoveryManager, peerDiscoveryManager } from './src/networking/PeerDiscoveryManager';
export { PeerExchangeService, peerExchangeService } from './src/networking/PeerExchangeService';
export { PeerRegistry, peerRegistry } from './src/networking/PeerRegistry';
export { SimplePeerScorer, simplePeerScorer } from './src/networking/SimplePeerScorer';
export { createNode, createNodeNode } from './src/node';
export { createBrowserPlatformStack } from './src/platform/createBrowserPlatformStack';
export { createNodePlatformStack } from './src/platform/createNodePlatformStack';
export type { Libp2pPlatformStack, PlatformProfile } from './src/platform/types';
export { IndexedDbReplicaStore, indexedDbReplicaStore } from './src/replica-store/IndexedDbReplicaStore';
export { InMemoryReplicaStore, inMemoryReplicaStore } from './src/replica-store/InMemoryReplicaStore';
export { ReplicaStoreInterface, replicaStore } from './src/replica-store/ReplicaStoreInterface';

export type { DataSerializer, FramedStreamCodec, WireCodec, WireFormatName } from './src/shared/serialization';
export {
  canonicalSerialize,
  createCborWireSerializer,
  createFramedStreamCodec,
  createJsonWireSerializer,
  createWireSerializer,
  getGenericDataSerailizer,
  WIRE_FORMAT,
} from './src/shared/serialization';

export type {
  DeChatComponents,
  DeChatFactory,
  DeChatStrategies,
} from './src/types';
