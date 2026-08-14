export { createBrowserNode } from './src/browser';
export { DECHAT_DEFAULTS, isConfigValid, resolveConfig } from './src/config/defaults';
export type { DeChatConfig } from './src/config/types';
export type { DeChatNodeHandle } from './src/createDeChatNode';
export { AntiEntropyManager, antiEntropyManager } from './src/data-convergence/AntiEntropyManager';
export {
  AntiEntropyNetworkExchange,
  antiEntropyNetworkExchangeEngine,
} from './src/data-convergence/AntiEntropyNetworkExchange';
export { PrefixTrie, TrieNode } from './src/data-convergence/PrefixTrie';
export { TrieBackedReplicaStore } from './src/data-convergence/TrieBackedReplicaStore';
export type { BroadcastPropagationInterface } from './src/data-propagation/broadcast/BroadcastPropagationInterface';
export { GossipSubPropagation, gossipSubPropagation } from './src/data-propagation/broadcast/GossipSubPropagation';
export type { DirectPropagationInterface } from './src/data-propagation/direct/DirectPropagationInterface';
export {
  DirectStreamPropagation,
  directStreamPropagation,
} from './src/data-propagation/direct/DirectStreamPropagation';
export type { PropagatedMessage, PropagationContext } from './src/data-propagation/types';
export {
  contentHashStrategy,
  Sha256ContentHashStrategy,
} from './src/data-replication/content-hash/Sha256ContentHashStrategy';
export type { ContentHashStrategyInterface } from './src/data-replication/content-hash/types';
export type { DataReplicationInterface } from './src/data-replication/DataReplicationInterface';
export {
  KReplicaContentReplication as KReplicaContentHashReplication,
  kReplicaContentHashReplication,
} from './src/data-replication/KReplicaContentReplication';
export {
  ReplicationMessageProtocolManager,
  replicationMessageProtocolManager,
} from './src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
export type { ReplicationProtocolInterface } from './src/data-replication/replication-protocol/ReplicationProtocolInterface';
export { TransportSelector } from './src/data-replication/replication-protocol/TransportSelector';
export {
  RoomScopedReplication,
  roomScopedReplication,
} from './src/data-replication/room-scope/RoomScopedReplication';
export type { RoomScopeInterface } from './src/data-replication/room-scope/RoomScopeInterface';
export { isRoomScope } from './src/data-replication/room-scope/RoomScopeInterface';
export type { RoomId } from './src/data-replication/room-scope/roomId';
export { asRoomId, isValidRoomId, ROOM_INDEX_PROTOCOL, roomTopic } from './src/data-replication/room-scope/roomId';
export type { RoomContentApplied } from './src/data-replication/room-scope/types';
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
export { peerIdFromEd25519PublicKeyBytes } from './src/networking/peerIdFromEd25519PublicKeyBytes';
export { peerIdFromNodeSeed } from './src/networking/peerIdFromNodeSeed';
export { SimplePeerScorer, simplePeerScorer } from './src/networking/SimplePeerScorer';
export { createNode, createNodeNode } from './src/node';
export { createBrowserPlatformStack } from './src/platform/createBrowserPlatformStack';
export { createNodePlatformStack } from './src/platform/createNodePlatformStack';
export type { Libp2pPlatformStack, PlatformProfile } from './src/platform/types';
export { IndexedDbReplicaStore, indexedDbReplicaStore } from './src/replica-store/IndexedDbReplicaStore';
export { InMemoryReplicaStore, inMemoryReplicaStore } from './src/replica-store/InMemoryReplicaStore';
export type { ReplicaStoreInterface } from './src/replica-store/ReplicaStoreInterface';
export { replicaStore } from './src/replica-store/ReplicaStoreInterface';

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

export {
  portableRoomReplicationStrategies,
  portableTopicReplicationStrategies,
} from './src/strategies/portableReplicationStrategies';
export type {
  DeChatComponents,
  DeChatFactory,
  DeChatStrategies,
} from './src/types';
