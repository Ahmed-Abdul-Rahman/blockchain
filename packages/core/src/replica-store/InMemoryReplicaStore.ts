import { DataSerializer } from '../shared/types';
import { DeChatComponents, DeChatFactory } from '../types';
import { ReplicaStoreInterface } from './ReplicaStoreInterface';

export class InMemoryReplicaStore implements ReplicaStoreInterface {
  private readonly storage: Map<string, Uint8Array>;

  serializer: DataSerializer;

  constructor(components: DeChatComponents) {
    this.serializer = components.serializer;
    this.storage = new Map<string, Uint8Array>();
  }

  async init(): Promise<void> {}

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
    throw new Error('DeChat is append-only. Publish a TOMBSTONE event instead.');
  }

  async keys(): Promise<readonly string[]> {
    return Array.from(this.storage.keys());
  }

  public async *getAllKeys(): AsyncIterable<string> {
    for (const key of this.storage.keys()) {
      yield key;
    }
  }

  async values(): Promise<readonly Uint8Array[]> {
    return Array.from(this.storage.values());
  }

  async entries(): Promise<MapIterator<[string, Uint8Array<ArrayBufferLike>]>> {
    return this.storage.entries();
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

export const inMemoryReplicaStore = (): DeChatFactory<ReplicaStoreInterface> => {
  return (components) => new InMemoryReplicaStore(components);
};
