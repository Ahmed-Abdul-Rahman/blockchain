/** biome-ignore-all lint/suspicious/noExplicitAny: test doubles */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomScopedReplication } from '../../../src/data-replication/room-scope/RoomScopedReplication';
import { isRoomScope } from '../../../src/data-replication/room-scope/RoomScopeInterface';
import { asRoomId, ROOM_INDEX_PROTOCOL, roomTopic } from '../../../src/data-replication/room-scope/roomId';
import { createCborWireSerializer } from '../../../src/shared/serialization';
import { DeChatComponents } from '../../../src/types';

const hashFor = (id: string): string => id.padEnd(64, '0');

describe('RoomScopedReplication', () => {
  let layer: RoomScopedReplication;
  let mockBroadcast: any;
  let mockDirect: any;
  let mockStorage: Map<string, Uint8Array>;
  let mockStore: any;
  let mockInner: any;
  let mockProtocol: any;
  let mockHasher: any;
  let serializer: ReturnType<typeof createCborWireSerializer>;

  const roomA = 'alpha-room';
  const roomB = 'beta-room';

  beforeEach(async () => {
    serializer = createCborWireSerializer();
    mockStorage = new Map();

    mockBroadcast = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(undefined),
    };
    mockDirect = {
      onReceive: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      unhandleProtocol: vi.fn().mockResolvedValue(undefined),
    };
    mockStore = {
      has: vi.fn(async (hash: string) => mockStorage.has(hash)),
      get: vi.fn(async (hash: string) => mockStorage.get(hash) ?? null),
      put: vi.fn(async (hash: string, data: Uint8Array) => {
        mockStorage.set(hash, data);
      }),
      getAllKeys: vi.fn(async function* () {
        for (const key of mockStorage.keys()) yield key;
      }),
    };
    mockProtocol = { setDelegate: vi.fn() };
    mockHasher = {
      hash: vi.fn((data: { id: string }) => hashFor(data.id)),
    };
    mockInner = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      replicationProtocol: mockProtocol,
      requestMissingData: vi.fn().mockResolvedValue(null),
      onPeerAnnounced: vi.fn(),
      onPeerRequested: vi.fn().mockResolvedValue({ found: false, closestPeers: [] }),
      onPeerDeliveredContent: vi.fn(),
      onPeerReportedError: vi.fn(),
    };

    const components = {
      libp2p: { peerId: { toString: () => 'self-peer' } },
      peerRegistry: { getPeers: vi.fn().mockReturnValue(['peer-1']) },
      serializer,
      strategies: {
        contentHasher: mockHasher,
        replicaStore: mockStore,
        broadcast: mockBroadcast,
        direct: mockDirect,
      },
    } as unknown as DeChatComponents;

    layer = new RoomScopedReplication(components, mockInner);
    await layer.start();
  });

  afterEach(async () => {
    await layer.stop();
    vi.clearAllMocks();
  });

  it('is a room-scope layer and rejects invalid room ids', () => {
    expect(isRoomScope(layer)).toBe(true);
    expect(() => asRoomId('not a room')).toThrow(/Invalid room id/);
  });

  it('refuses unscoped onLocalDataProduced', async () => {
    await expect(layer.onLocalDataProduced({ id: 'x' })).rejects.toThrow(/Unscoped produce/);
  });

  it('refuses produce until the room is joined', async () => {
    await expect(layer.produce(roomA, { id: 'm1', roomId: roomA })).rejects.toThrow(/without joining/);
  });

  it('persists locally and announces on the room topic, not the inner global announce path', async () => {
    await layer.joinRoom(roomA);
    const envelope = { id: 'm1', roomId: roomA, body: 'hello' };
    const hash = await layer.produce(roomA, envelope);

    expect(hash).toBe(hashFor('m1'));
    expect(mockStore.put).toHaveBeenCalled();
    expect(mockBroadcast.publish).toHaveBeenCalledWith(
      roomTopic(asRoomId(roomA)),
      expect.objectContaining({
        payload: expect.objectContaining({ type: 'room_announce', roomId: roomA, hash }),
      }),
    );
    expect(mockInner.onLocalDataProduced).toBeUndefined();
    expect(layer.getRoomHashes(roomA)).toContain(hash);
  });

  it('still persists when room announce cannot be gossiped', async () => {
    mockBroadcast.publish.mockRejectedValueOnce(new Error('PublishError.NoPeersSubscribedToTopic'));
    await layer.joinRoom(roomA);
    const hash = await layer.produce(roomA, { id: 'solo', roomId: roomA });
    expect(hash).toBe(hashFor('solo'));
    expect(mockStore.put).toHaveBeenCalled();
    expect(layer.getRoomHashes(roomA)).toContain(hash);
  });

  it('does not pull content announced for a room that was not joined', async () => {
    const announceHandler = mockBroadcast.subscribe.mock.calls[0]?.[1];
    await layer.joinRoom(roomA);
    const roomBHandler = mockBroadcast.subscribe.mock.calls.find(
      (call: unknown[]) => call[0] === roomTopic(asRoomId(roomA)),
    )?.[1];

    expect(roomBHandler).toBeTypeOf('function');
    await roomBHandler(
      {
        id: hashFor('other'),
        payload: { type: 'room_announce', roomId: roomB, hash: hashFor('other') },
        from: 'peer-1',
        timestamp: Date.now(),
      },
      { from: { toString: () => 'peer-1' }, receivedAt: Date.now() },
    );

    expect(mockInner.requestMissingData).not.toHaveBeenCalled();
    expect(announceHandler).toBeUndefined();
  });

  it('pulls announced content only for a joined room', async () => {
    await layer.joinRoom(roomA);
    const handler = mockBroadcast.subscribe.mock.calls.find(
      (call: unknown[]) => call[0] === roomTopic(asRoomId(roomA)),
    )?.[1];

    const hash = hashFor('m2');
    const bytes = serializer.serialize({ id: 'm2', roomId: roomA });
    mockInner.requestMissingData.mockImplementation(async () => {
      mockStorage.set(hash, bytes);
      return serializer.deserialize(bytes);
    });

    await handler(
      {
        id: hash,
        payload: { type: 'room_announce', roomId: roomA, hash },
        from: 'peer-1',
        timestamp: Date.now(),
      },
      { from: { toString: () => 'peer-1' }, receivedAt: Date.now() },
    );

    expect(mockInner.requestMissingData).toHaveBeenCalledWith(hash, 'peer-1');
    expect(layer.getRoomHashes(roomA)).toContain(hash);
  });

  it('ignores anti-entropy fetches for hashes not mapped to a joined room', async () => {
    await layer.joinRoom(roomA);
    const result = await layer.requestMissingData(hashFor('unknown'), 'peer-1');
    expect(result).toBeNull();
    expect(mockInner.requestMissingData).not.toHaveBeenCalled();
  });

  it('stops pulling after leaveRoom', async () => {
    await layer.joinRoom(roomA);
    const handler = mockBroadcast.subscribe.mock.calls.find(
      (call: unknown[]) => call[0] === roomTopic(asRoomId(roomA)),
    )?.[1];
    await layer.leaveRoom(roomA);

    await handler(
      {
        id: hashFor('late'),
        payload: { type: 'room_announce', roomId: roomA, hash: hashFor('late') },
        from: 'peer-1',
        timestamp: Date.now(),
      },
      { from: { toString: () => 'peer-1' }, receivedAt: Date.now() },
    );

    expect(mockInner.requestMissingData).not.toHaveBeenCalled();
    expect(layer.isMember(roomA)).toBe(false);
  });

  it('rebuilds the room index from stored envelopes that include roomId', async () => {
    const hash = hashFor('persisted');
    mockStorage.set(hash, serializer.serialize({ id: 'persisted', roomId: roomA }));

    const components = {
      libp2p: { peerId: { toString: () => 'self-peer' } },
      peerRegistry: { getPeers: () => [] },
      serializer,
      strategies: {
        contentHasher: mockHasher,
        replicaStore: mockStore,
        broadcast: mockBroadcast,
        direct: mockDirect,
      },
    } as unknown as DeChatComponents;

    const restored = new RoomScopedReplication(components, mockInner);
    await restored.start();
    expect(restored.getRoomHashes(roomA)).toContain(hash);
    await restored.stop();
  });

  it('applies a remote room index only for joined rooms', async () => {
    await layer.joinRoom(roomA);
    const indexHandler = mockDirect.onReceive.mock.calls.find(
      (call: unknown[]) => call[0] === ROOM_INDEX_PROTOCOL,
    )?.[1];
    expect(indexHandler).toBeTypeOf('function');

    const hash = hashFor('from-index');
    const bytes = serializer.serialize({ id: 'from-index', roomId: roomA });
    mockInner.requestMissingData.mockImplementation(async () => {
      mockStorage.set(hash, bytes);
      return serializer.deserialize(bytes);
    });

    await indexHandler(
      {
        id: roomA,
        payload: { type: 'room_index', roomId: roomA, hashes: [hash] },
        from: 'peer-1',
        timestamp: Date.now(),
      },
      { from: { toString: () => 'peer-1' }, receivedAt: Date.now() },
    );

    expect(mockInner.requestMissingData).toHaveBeenCalledWith(hash, 'peer-1');
  });
});
