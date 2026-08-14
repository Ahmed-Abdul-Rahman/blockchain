import { antiEntropyManager } from '../data-convergence/AntiEntropyManager';
import { antiEntropyNetworkExchangeEngine } from '../data-convergence/AntiEntropyNetworkExchange';
import { gossipSubPropagation } from '../data-propagation/broadcast/GossipSubPropagation';
import { directStreamPropagation } from '../data-propagation/direct/DirectStreamPropagation';
import { contentHashStrategy } from '../data-replication/content-hash/Sha256ContentHashStrategy';
import { replicationMessageProtocolManager } from '../data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { roomScopedReplication } from '../data-replication/room-scope/RoomScopedReplication';
import { topicBasedContentHashReplication } from '../data-replication/TopicBasedContentReplication';
import { inMemoryReplicaStore } from '../replica-store/InMemoryReplicaStore';
import type { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import type { DeChatFactory, DeChatStrategies } from '../types';

/**
 * Portable topic-based replication stack (no TCP/mDNS/LevelDB).
 * Suitable for Node hybrid smokes and browser wiring; override `replicaStore` for IndexedDB.
 */
export const portableTopicReplicationStrategies = (
  replicaStore: DeChatFactory<ReplicaStoreInterface> = inMemoryReplicaStore(),
): DeChatStrategies => ({
  broadcast: gossipSubPropagation(),
  direct: directStreamPropagation(),
  contentHasher: contentHashStrategy(),
  replicaStore,
  replicationProtocol: replicationMessageProtocolManager(),
  dataReplication: topicBasedContentHashReplication(),
  networkExchanger: antiEntropyNetworkExchangeEngine(),
  antiEntropyManager: antiEntropyManager(),
});

/**
 * Portable stack with {@link roomScopedReplication} wrapping topic-based replication (ADR-0005).
 */
export const portableRoomReplicationStrategies = (
  replicaStore: DeChatFactory<ReplicaStoreInterface> = inMemoryReplicaStore(),
): DeChatStrategies => ({
  ...portableTopicReplicationStrategies(replicaStore),
  dataReplication: roomScopedReplication(),
});
