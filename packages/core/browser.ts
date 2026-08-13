/**
 * Browser entry for `@dechat/core` — no TCP/mDNS/LevelDB.
 * Use {@link createBrowserNode} with bootstrap multiaddrs.
 */

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
export { BroadcastPropagationInterface } from './src/data-propagation/broadcast/BroadcastPropagationInterface';
export { GossipSubPropagation, gossipSubPropagation } from './src/data-propagation/broadcast/GossipSubPropagation';
export { DirectPropagationInterface } from './src/data-propagation/direct/DirectPropagationInterface';
export {
  DirectStreamPropagation,
  directStreamPropagation,
} from './src/data-propagation/direct/DirectStreamPropagation';
export type { MessageHandler, PropagatedMessage, PropagationContext } from './src/data-propagation/types';
export {
  contentHashStrategy,
  Sha256ContentHashStrategy,
} from './src/data-replication/content-hash/Sha256ContentHashStrategy';
export { ContentHashStrategyInterface } from './src/data-replication/content-hash/types';
export { DataReplicationInterface } from './src/data-replication/DataReplicationInterface';
export {
  ReplicationMessageProtocolManager,
  replicationMessageProtocolManager,
} from './src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
export { ReplicationProtocolInterface } from './src/data-replication/replication-protocol/ReplicationProtocolInterface';
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
export { PeerAuthenticator, peerAuthenticator } from './src/networking/PeerAuthenticator';
export { PeerRegistry, peerRegistry } from './src/networking/PeerRegistry';
export { createBrowserPlatformStack } from './src/platform/createBrowserPlatformStack';
export type { Libp2pPlatformStack, PlatformProfile } from './src/platform/types';
export { IndexedDbReplicaStore, indexedDbReplicaStore } from './src/replica-store/IndexedDbReplicaStore';
export { InMemoryReplicaStore, inMemoryReplicaStore } from './src/replica-store/InMemoryReplicaStore';
export { ReplicaStoreInterface, replicaStore } from './src/replica-store/ReplicaStoreInterface';
export { createWireSerializer, WIRE_FORMAT } from './src/shared/serialization';
export {
  portableRoomReplicationStrategies,
  portableTopicReplicationStrategies,
} from './src/strategies/portableReplicationStrategies';
export type {
  DeChatComponents,
  DeChatFactory,
  DeChatStrategies,
} from './src/types';
