/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { beforeEach, describe, expect, it } from 'vitest';
import { getGenericDataSerailizer } from '../../../src/data-replication/serializers';
import { InMemoryReplicaStore } from '../../../src/replica-store/InMemoryReplicaStore';
import { DeChatComponents } from '../../../src/types';

describe('InMemoryReplicaStore', () => {
  let store: InMemoryReplicaStore;
  let mockComponents: DeChatComponents;

  beforeEach(() => {
    mockComponents = {
      serializer: getGenericDataSerailizer(),
    } as any;

    store = new InMemoryReplicaStore(mockComponents);
  });

  it('should return false/undefined for non-existent keys', async () => {
    const hasKey = await store.has('missing-key');
    const value = await store.get('missing-key');

    expect(hasKey).toBe(false);
    expect(value).toBeNull();
  });

  it('should put and retrieve data correctly', async () => {
    const key = 'test-hash-123';
    const data = new Uint8Array([10, 20, 30, 40]);

    await store.put(key, data);

    const hasKey = await store.has(key);
    const retrievedData = await store.get(key);

    expect(hasKey).toBe(true);
    expect(retrievedData).toEqual(data);
  });

  it('should delete data correctly', async () => {
    const key = 'test-hash-456';
    const data = new Uint8Array([50, 60]);

    // Setup
    await store.put(key, data);
    expect(await store.has(key)).toBe(true);

    // Act
    await store.delete(key);

    // Assert
    expect(await store.has(key)).toBe(false);
    expect(await store.get(key)).toBeNull();
  });
});
