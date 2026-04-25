/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sha256ContentHashStrategy } from '../../../src/data-replication/content-hash/Sha256ContentHashStrategy';
import { KReplicaContentHashReplication } from '../../../src/data-replication/KReplicaContentHashReplication';
import { getGenericDataSerailizer } from '../../../src/data-replication/serializers';

describe('KReplicaContentHashReplication', () => {
  let replication: KReplicaContentHashReplication;
  let mockStorage: any;
  let mockProtocol: any;
  let knownPeers: string[];

  beforeEach(() => {
    knownPeers = ['peer1', 'peer2', 'peer3', 'peer4', 'peer5'];

    mockStorage = {
      has: vi.fn().mockResolvedValue(false),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    };

    mockProtocol = {
      start: vi.fn(),
      stop: vi.fn(),
      announceToNetwork: vi.fn().mockResolvedValue(undefined),
      requestDataAndAwaitResponse: vi.fn(),
    };

    replication = new KReplicaContentHashReplication(
      'selfPeer',
      () => knownPeers,
      new Sha256ContentHashStrategy(),
      mockStorage,
      getGenericDataSerailizer(),
      mockProtocol,
      3, // K = 3
    );
  });

  it('shouldReplicate returns true if network view is smaller than K', () => {
    knownPeers = ['peer1']; // Total network = 2 (self + peer1), which is <= K(3)
    const should = replication.shouldReplicate('some-hash');
    expect(should).toBe(true);
  });

  it('onLocalDataProduced should hash, store, and announce data', async () => {
    await replication.onLocalDataProduced({ hello: 'world' });

    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockProtocol.announceToNetwork).toHaveBeenCalled();
  });

  it('onRemoteDataReceived should store and announce if shouldReplicate is true', async () => {
    vi.spyOn(replication, 'shouldReplicate').mockReturnValue(true);

    await replication.onRemoteDataReceived({ data: 'test' }, 'remotePeer');

    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockProtocol.announceToNetwork).toHaveBeenCalled();
  });

  it('onPeerAnnounced should request data if not in storage and shouldReplicate is true', async () => {
    vi.spyOn(replication, 'shouldReplicate').mockReturnValue(true);
    const announceHandler = vi.fn().mockResolvedValue(undefined);

    await replication.onPeerAnnounced('hash1', 'peerX', announceHandler);

    expect(announceHandler).toHaveBeenCalled();
  });

  it('requestMissingData should return null if DHT search exhausts without finding data', async () => {
    mockProtocol.requestDataAndAwaitResponse.mockResolvedValue({
      type: 'replication_error',
      reason: 'not_found',
      closerPeers: [],
    });

    const result = await replication.requestMissingData('missing-hash');
    expect(result).toBeNull();
  });
});
