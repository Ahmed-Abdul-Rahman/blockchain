/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelDbReplicaStore } from '../../../src/replica-store/LevelDbReplicaStore';

// 1. Create our mock DB implementation
const mockDb = {
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  status: 'open',
  close: vi.fn(),
};

// 2. Intercept the 'level' import so it doesn't create real files on disk during tests
vi.mock('level', () => {
  return {
    Level: vi.fn().mockImplementation(() => mockDb),
  };
});

describe('LevelDbReplicaStore', () => {
  let store: LevelDbReplicaStore;
  let mockSerializer: any;

  beforeEach(() => {
    // 3. Create a dummy serializer that just passes data through
    mockSerializer = {
      serialize: vi.fn((data) => data),
      deserialize: vi.fn((data) => data),
    };

    // 4. Instantiate with the proper signature (string path, serializer)
    store = new LevelDbReplicaStore('./dummy-test-db-path', mockSerializer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return true if data exists (has)', async () => {
    mockDb.get.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const result = await store.has('key1');
    expect(result).toBe(true);
    expect(mockDb.get).toHaveBeenCalledWith('key1');
  });

  it('should return false if data does not exist (has)', async () => {
    // LevelDB throws an error with code 'LEVEL_NOT_FOUND' if a key isn't present
    mockDb.get.mockRejectedValueOnce({ code: 'LEVEL_NOT_FOUND' });
    const result = await store.has('key2');
    expect(result).toBe(false);
  });

  it('should put data into the db', async () => {
    mockDb.put.mockResolvedValueOnce(undefined);
    const data = new Uint8Array([9, 9, 9]);

    await store.put('key3', data);

    // Wrap 'data' in Buffer.from() to match the type passed to LevelDB
    expect(mockDb.put).toHaveBeenCalledWith('key3', Buffer.from(data));
  });

  it('should retrieve data from the db', async () => {
    const expectedData = new Uint8Array([4, 5, 6]);
    mockDb.get.mockResolvedValueOnce(expectedData);

    const result = await store.get('key4');
    expect(result).toEqual(expectedData);
  });

  it('should delete data from the db', async () => {
    mockDb.del.mockResolvedValueOnce(undefined);
    await store.delete('key5');
    expect(mockDb.del).toHaveBeenCalledWith('key5');
  });
});
