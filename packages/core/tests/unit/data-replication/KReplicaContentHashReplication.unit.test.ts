/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KReplicaContentHashReplication,
  kReplicaContentHashReplication,
} from '../../../src/data-replication/KReplicaContentHashReplication';
import { DeChatComponents } from '../../../src/types';

describe('KReplicaContentHashReplication', () => {
  let engine: KReplicaContentHashReplication;
  let mockComponents: Partial<DeChatComponents>;

  let mockHashStrategy: any;
  let mockStorage: any;
  let mockReplicationProtocol: any;
  let mockSerializer: any;
  let mockRegistry: any;

  beforeEach(() => {
    mockHashStrategy = { hash: vi.fn((data) => `hash-${data.message}`) };
    mockStorage = {
      has: vi.fn().mockResolvedValue(false),
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mockReplicationProtocol = {
      setDelegate: vi.fn(),
      announceToNetwork: vi.fn().mockResolvedValue(undefined),
      requestDataAndAwaitResponse: vi.fn(),
    };
    mockSerializer = {
      serialize: vi.fn((data) => new Uint8Array(Buffer.from(JSON.stringify(data)))),
      deserialize: vi.fn((buf) => JSON.parse(Buffer.from(buf).toString('utf-8'))),
    };
    mockRegistry = {
      getPeers: vi.fn().mockReturnValue([{ peerId: 'peer1' }, { peerId: 'peer2' }]),
    };

    mockComponents = {
      libp2p: { peerId: { toString: () => 'self-peer-id' } } as any,
      peerRegistry: mockRegistry,
      config: {
        strategies: {
          // Fixed path based on error trace
          replication: { kReplicaCount: 3, maxAttempts: 3, baseDelayMs: 200 },
        },
      } as any,
      strategies: {
        contentHasher: mockHashStrategy,
        replicaStore: mockStorage,
        replicationProtocol: mockReplicationProtocol,
        serializer: mockSerializer,
      } as any,
    };

    engine = kReplicaContentHashReplication()(mockComponents as DeChatComponents);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize and set delegate on start', async () => {
    await engine.start();
    expect(mockReplicationProtocol.setDelegate).toHaveBeenCalledWith(engine);
  });

  it('should persist and announce data on local production', async () => {
    const data = { message: 'hello' };
    await engine.onLocalDataProduced(data);

    expect(mockHashStrategy.hash).toHaveBeenCalledWith(data);
    expect(mockStorage.has).toHaveBeenCalledWith('hash-hello');
    expect(mockStorage.put).toHaveBeenCalledWith('hash-hello', expect.any(Uint8Array));
    expect(mockReplicationProtocol.announceToNetwork).toHaveBeenCalledWith('hash-hello');
  });

  it('should replicate remote data if we are one of the K closest peers', async () => {
    vi.spyOn(engine as any, 'shouldReplicate').mockReturnValue(true);

    const data = { message: 'remote' };
    await engine.onRemoteDataReceived(data, 'some-peer');

    expect(mockStorage.put).toHaveBeenCalledWith('hash-remote', expect.any(Uint8Array));
    expect(mockReplicationProtocol.announceToNetwork).toHaveBeenCalledWith('hash-remote');
  });
});
