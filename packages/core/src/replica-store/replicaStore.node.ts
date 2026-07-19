import { DeChatFactory } from '../types';
import { inMemoryReplicaStore } from './InMemoryReplicaStore';
import { levelDbReplicaStore } from './LevelDbReplicaStore';
import type { ReplicaStoreInterface } from './ReplicaStoreInterface';

/**
 * Node replica-store factory — supports `IN_MEMORY` and `LEVEL_DB`.
 * Pulling this module into a browser bundle will also pull `level`.
 */
export const replicaStoreNode = (storeType: 'IN_MEMORY' | 'LEVEL_DB'): DeChatFactory<ReplicaStoreInterface> => {
  if (storeType === 'LEVEL_DB') return levelDbReplicaStore();
  return inMemoryReplicaStore();
};
