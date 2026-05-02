import { ContentHash, DataSerializer } from '../data-replication/types';
import { ReplicaStoreInterface } from '../replica-store/ReplicaStoreInterface';
import { PrefixTrie } from './PrefixTrie';

/**
 * A Decorator for ReplicaStoreInterface that keeps an Incremental Prefix Merkle Trie
 * in perfect sync with the underlying database storage.
 */
export class TrieBackedReplicaStore implements ReplicaStoreInterface {
  private isInitialized = false;
  private readonly baseStore: ReplicaStoreInterface;
  private readonly trie: PrefixTrie;
  readonly serializer: DataSerializer;

  constructor(baseStore: ReplicaStoreInterface, trie: PrefixTrie, serializer: DataSerializer) {
    this.baseStore = baseStore;
    this.trie = trie;
    this.serializer = serializer;
  }

  /**
   * Streams all existing keys from the database and rebuilds the Merkle Trie in memory.
   * Must be called and awaited BEFORE the libp2p network starts.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;
    for await (const key of this.baseStore.getAllKeys()) {
      this.trie.insert(key);
    }
    this.isInitialized = true;
  }

  /**
   * Ensures the store is not accessed while the cold boot sequence is running.
   */
  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('[TrieBackedReplicaStore] Store accessed before initialization lock completed.');
    }
  }

  /**
   * Intercepts data persistence to synchronously update the Trie.
   */
  public async put(key: string, data: Uint8Array): Promise<void> {
    this.checkInitialized();
    await this.baseStore.put(key, data);
    this.trie.insert(key);
  }

  public async get(key: string): Promise<Uint8Array | null> {
    this.checkInitialized();
    return this.baseStore.get(key);
  }

  public async has(key: string): Promise<boolean> {
    this.checkInitialized();
    return this.baseStore.has(key);
  }

  public async *getAllKeys(): AsyncIterable<string> {
    this.checkInitialized();
    yield* this.baseStore.getAllKeys();
  }

  delete(hash: ContentHash): Promise<void> {
    throw new Error('DeChat is append-only. Publish a TOMBSTONE event instead.');
  }

  keys(): Promise<readonly ContentHash[] | AsyncIterable<ContentHash>> {
    return this.baseStore.keys();
  }

  values(): Promise<readonly Uint8Array[] | AsyncIterable<Uint8Array>> {
    return this.baseStore.values();
  }

  entries(): Promise<MapIterator<[string, Uint8Array<ArrayBufferLike>]>> {
    return this.baseStore.entries();
  }

  clear(): Promise<void> {
    return this.baseStore.clear();
  }

  size(): Promise<number> {
    return this.baseStore.size();
  }

  close(): Promise<void> {
    return this.baseStore.close();
  }
}
