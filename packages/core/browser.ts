/**
 * Browser entry for `@dechat/core` — no TCP/mDNS/LevelDB.
 * Use {@link createBrowserNode} with bootstrap multiaddrs.
 */

export { createBrowserNode } from './src/browser';
export { DECHAT_DEFAULTS, isConfigValid, resolveConfig } from './src/config/defaults';
export type { DeChatConfig } from './src/config/types';
// Portable networking / protocol surfaces commonly needed by apps
export { PeerAuthenticator, peerAuthenticator } from './src/networking/PeerAuthenticator';
export { PeerRegistry, peerRegistry } from './src/networking/PeerRegistry';
export { createBrowserPlatformStack } from './src/platform/createBrowserPlatformStack';
export type { Libp2pPlatformStack, PlatformProfile } from './src/platform/types';
export { IndexedDbReplicaStore, indexedDbReplicaStore } from './src/replica-store/IndexedDbReplicaStore';
export { InMemoryReplicaStore, inMemoryReplicaStore } from './src/replica-store/InMemoryReplicaStore';
export { ReplicaStoreInterface, replicaStore } from './src/replica-store/ReplicaStoreInterface';
export { createWireSerializer, WIRE_FORMAT } from './src/shared/serialization';
export type {
  DeChatComponents,
  DeChatFactory,
  DeChatStrategies,
} from './src/types';
