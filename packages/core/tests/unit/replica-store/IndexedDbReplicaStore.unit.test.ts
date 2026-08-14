/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbReplicaStore } from '../../../src/replica-store/IndexedDbReplicaStore';
import { createCborWireSerializer } from '../../../src/shared/serialization';
import { DeChatComponents } from '../../../src/types';

const componentsFor = (indexedDbName: string): DeChatComponents =>
  ({
    serializer: createCborWireSerializer(),
    config: { strategies: { store: { indexedDbName } } },
  }) as any;

describe('IndexedDbReplicaStore reload', () => {
  const stores: IndexedDbReplicaStore[] = [];

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      await store.close();
    }
  });

  it('throws before init (boot lock)', async () => {
    const store = new IndexedDbReplicaStore(componentsFor('dechat-idb-boot-lock'));
    stores.push(store);
    await expect(store.has('h1')).rejects.toThrow(/init\(\) must be called/);
  });

  it('puts a hash, reopens the same database, and still has the bytes', async () => {
    const dbName = `dechat-idb-reload-${Date.now()}`;
    const payload = new Uint8Array([7, 8, 9, 10]);

    const first = new IndexedDbReplicaStore(componentsFor(dbName));
    stores.push(first);
    await first.init();
    await first.put('content-hash-1', payload);
    expect(await first.has('content-hash-1')).toBe(true);
    await first.close();

    const second = new IndexedDbReplicaStore(componentsFor(dbName));
    stores.push(second);
    await second.init();
    expect(await second.has('content-hash-1')).toBe(true);
    expect(await second.get('content-hash-1')).toEqual(payload);
  });
});
