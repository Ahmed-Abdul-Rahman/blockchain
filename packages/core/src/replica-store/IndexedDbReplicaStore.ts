import { DataSerializer } from '../shared/types';
import { DeChatComponents, DeChatFactory } from '../types';
import { ReplicaStoreInterface } from './ReplicaStoreInterface';

const STORE_NAME = 'replicas';

/**
 * Browser durable CAS store backed by IndexedDB.
 * Satisfies {@link ReplicaStoreInterface} — the third adapter on the existing store seam.
 */
export class IndexedDbReplicaStore implements ReplicaStoreInterface {
  serializer: DataSerializer;

  private readonly dbName: string;

  private db: IDBDatabase | null = null;

  constructor(components: DeChatComponents) {
    this.serializer = components.serializer;
    this.dbName = components.config.strategies.store.indexedDbName ?? 'dechat-replicas';
  }

  async init(): Promise<void> {
    this.db = await openDatabase(this.dbName);
  }

  private requireDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('IndexedDbReplicaStore.init() must be called before use (boot lock).');
    }
    return this.db;
  }

  async has(hash: string): Promise<boolean> {
    const value = await this.get(hash);
    return value !== null;
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const db = this.requireDb();
    return idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(hash)).then((value) => {
      if (value == null) return null;
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      return null;
    });
  }

  async put(hash: string, data: Uint8Array): Promise<void> {
    const db = this.requireDb();
    const copy = data.slice();
    await idbRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(copy, hash));
  }

  async delete(_hash: string): Promise<void> {
    throw new Error('DeChat is append-only. Publish a TOMBSTONE event instead.');
  }

  async keys(): Promise<readonly string[]> {
    const db = this.requireDb();
    return idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys()).then((keys) =>
      keys.map(String),
    );
  }

  public async *getAllKeys(): AsyncIterable<string> {
    const keys = await this.keys();
    for (const key of keys) {
      yield key;
    }
  }

  async values(): Promise<readonly Uint8Array[]> {
    const db = this.requireDb();
    const values = await idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    return values.map((value) => {
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      return new Uint8Array();
    });
  }

  async entries(): Promise<MapIterator<[string, Uint8Array<ArrayBufferLike>]>> {
    const map = new Map<string, Uint8Array>();
    const keys = await this.keys();
    for (const key of keys) {
      const value = await this.get(key);
      if (value) map.set(key, value);
    }
    return map.entries();
  }

  async size(): Promise<number> {
    const db = this.requireDb();
    return idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count());
  }

  async clear(): Promise<void> {
    const db = this.requireDb();
    await idbRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear());
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}

export const indexedDbReplicaStore = (): DeChatFactory<ReplicaStoreInterface> => {
  return (components) => new IndexedDbReplicaStore(components);
};

const openDatabase = (name: string): Promise<IDBDatabase> => {
  const indexedDB = globalThis.indexedDB;
  if (!indexedDB) {
    return Promise.reject(new Error('IndexedDB is not available in this runtime'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
};

const idbRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
