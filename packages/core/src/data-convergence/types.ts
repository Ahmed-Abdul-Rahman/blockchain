import { ContentHash } from '../data-replication/types';

export interface ReplicationInventory {
  readonly algorithm: string;
  readonly hashes: readonly ContentHash[];
}

export interface StateSyncInterface {
  getInventory: (peerId: string) => Promise<ReplicationInventory>;
  requestContent: (peerId: string, hash: ContentHash) => Promise<Uint8Array>;
}
