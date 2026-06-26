/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelDbReplicaStore } from '../../../src/replica-store/LevelDbReplicaStore';
import { DeChatComponents } from '../../../src/types';

vi.mock('level', () => {
  return {
    Level: vi.fn().mockImplementation(function () {
      return {
        get: vi.fn(),
        put: vi.fn(),
        del: vi.fn(),
      };
    }),
  };
});
describe('LevelDbReplicaStore', () => {
  let store: LevelDbReplicaStore;
  let mockComponents: Partial<DeChatComponents>;
  let mockSerializer: any;
  let mockDbInstance: any;

  beforeEach(() => {
    mockSerializer = {
      serialize: vi.fn(),
      deserialize: vi.fn(),
    };

    mockComponents = {
      // Configuration for LevelDB
      config: {
        strategies: {
          store: { dbPath: './dummy-test-db-path' },
        },
      } as any,
      // Pass the serializer (based on your stack trace, this was attached directly to components here)
      serializer: mockSerializer as any,
    };

    store = new LevelDbReplicaStore(mockComponents as DeChatComponents);
    mockDbInstance = (store as any).db;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return true if data exists (has)', async () => {
    mockDbInstance.get.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const result = await store.has('key1');
    expect(result).toBe(true);
    expect(mockDbInstance.get).toHaveBeenCalledWith('key1');
  });

  it('should return false if data does not exist (has)', async () => {
    // LevelDB throws an error with code 'LEVEL_NOT_FOUND' if a key isn't present
    mockDbInstance.get.mockRejectedValueOnce({ code: 'LEVEL_NOT_FOUND' });
    const result = await store.has('key2');
    expect(result).toBe(false);
  });

  it('should put data into the db', async () => {
    mockDbInstance.put.mockResolvedValueOnce(undefined);
    const data = new Uint8Array([9, 9, 9]);

    await store.put('key3', data);
    expect(mockDbInstance.put).toHaveBeenCalledWith('key3', Buffer.from(data));
  });

  it('should retrieve data from the db', async () => {
    const expectedData = new Uint8Array([4, 5, 6]);
    mockDbInstance.get.mockResolvedValueOnce(expectedData);

    const result = await store.get('key4');
    expect(result).toEqual(expectedData);
  });

  it('should reject delete (append-only store)', async () => {
    await expect(store.delete('key5')).rejects.toThrow('DeChat is append-only. Publish a TOMBSTONE event instead.');
    expect(mockDbInstance.del).not.toHaveBeenCalled();
  });
});
