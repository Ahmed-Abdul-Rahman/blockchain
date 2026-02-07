import { ReplicaStore } from './types';

export class InMemoryReplicaStore implements ReplicaStore {
  private readonly storage = new Map<string, Uint8Array>();

  async has(hash: string): Promise<boolean> {
    return this.storage.has(hash);
  }

  async get(hash: string): Promise<Uint8Array | null> {
    return this.storage.get(hash) ?? null;
  }

  async put(hash: string, data: Uint8Array): Promise<void> {
    this.storage.set(hash, data);
  }

  async delete(hash: string): Promise<void> {
    this.storage.delete(hash);
  }

  async keys(): Promise<readonly string[]> {
    return Array.from(this.storage.keys());
  }

  async size(): Promise<number> {
    return this.storage.size;
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async close(): Promise<void> {
    // No-op for memory store
    this.storage.clear();
  }
}
