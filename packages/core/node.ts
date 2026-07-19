/**
 * Node entry for `@dechat/core` — includes LevelDB and the Node platform stack.
 * Prefer this import when you need `LEVEL_DB` or explicit Node facades.
 */
export * from './index';
export { createNodeNode } from './src/node';
export { createNodePlatformStack } from './src/platform/createNodePlatformStack';
export { LevelDbReplicaStore, levelDbReplicaStore } from './src/replica-store/LevelDbReplicaStore';
export { replicaStoreNode } from './src/replica-store/replicaStore.node';
