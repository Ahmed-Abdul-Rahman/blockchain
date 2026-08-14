/** biome-ignore-all lint/suspicious/noExplicitAny: test doubles */
import { peerIdFromNodeSeed } from '@dechat/core';
import { genEd25519KeyPair } from '@dechat/crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatClientImpl } from '../../src/ChatClient';
import { EncryptedChatEnvelope } from '../../src/domain/types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const jsonSerializer = {
  serialize: (data: unknown) => encoder.encode(JSON.stringify(data)),
  deserialize: <T>(bytes: Uint8Array): T => JSON.parse(decoder.decode(bytes)) as T,
};

describe('ChatClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createClient = async () => {
    const seed = 'chat-client-unit-seed';
    const nodeKey = await genEd25519KeyPair(seed);
    const peerId = await peerIdFromNodeSeed(seed);
    const stored = new Map<string, Uint8Array>();
    const membership = new Set<string>();
    let produced: EncryptedChatEnvelope | undefined;
    const scope = {
      joinRoom: vi.fn(async (room: string) => {
        membership.add(room);
      }),
      leaveRoom: vi.fn(async (room: string) => {
        membership.delete(room);
      }),
      produce: vi.fn(async (_room: string, data: EncryptedChatEnvelope) => {
        produced = data;
        const hash = `h-${stored.size + 1}`;
        stored.set(hash, jsonSerializer.serialize(data));
        return hash;
      }),
      getRoomHashes: vi.fn(() => [...stored.keys()]),
      subscribe: vi.fn(() => () => undefined),
      isMember: vi.fn((room: string) => membership.has(room)),
      start: vi.fn(),
      stop: vi.fn(),
      syncRoom: vi.fn(),
    };
    const direct = {
      onReceive: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      removeHandler: vi.fn().mockResolvedValue(undefined),
      unhandleProtocol: vi.fn(),
    };

    const client = new ChatClientImpl({
      components: {
        libp2p: {
          peerId: { toString: () => peerId },
          getMultiaddrs: () => [{ toString: () => `/ip4/127.0.0.1/tcp/4001/p2p/${peerId}` }],
        },
        config: { peerAuthenticator: { nodeKey } },
        peerRegistry: { getPeers: () => [] },
        serializer: jsonSerializer,
        strategies: {
          roomScope: scope,
          replicaStore: {
            get: async (hash: string) => stored.get(hash) ?? null,
          },
          direct,
        },
      },
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    } as any);

    return { client, scope, produced: () => produced, stored, peerId };
  };

  it('throws when the node has no room-scope layer', () => {
    expect(
      () =>
        new ChatClientImpl({
          components: { libp2p: { peerId: { toString: () => 'p' } }, strategies: {} },
          start: vi.fn(),
          stop: vi.fn(),
        } as any),
    ).toThrow(/room-scoped replication/);
  });

  it('joins a room, stores ciphertext, and projects decrypted history', async () => {
    const { client, scope, produced, stored, peerId } = await createClient();

    await client.start();
    await client.joinRoom('lobby');
    const hash = await client.sendMessage('lobby', { text: 'hello' });
    const history = await client.getHistory('lobby');
    await client.stop();

    expect(hash).toMatch(/^h-/);
    expect(scope.joinRoom).toHaveBeenCalledWith('lobby');
    expect(produced()?.type).toBe('chat_message');
    expect(produced()?.ciphertext).toBeTruthy();
    expect(JSON.stringify(produced())).not.toContain('hello');
    expect(decoder.decode([...stored.values()][0]!)).not.toContain('hello');
    expect(history).toHaveLength(1);
    expect(history[0]?.body.text).toBe('hello');
    expect(history[0]?.senderPeerId).toBe(peerId);
    expect(history[0]?.untrustedDisplayName).toBeUndefined();
    expect(client.getListenAddrs()[0]).toContain(peerId);
  });

  it('refuses to send until the room is joined', async () => {
    const { client } = await createClient();
    await expect(client.sendMessage('lobby', { text: 'nope' })).rejects.toThrow(/joining "lobby" first/);
  });

  it('tracks membership after join and leave and discards the room key', async () => {
    const { client } = await createClient();
    expect(client.isMember('lobby')).toBe(false);
    await client.joinRoom('lobby');
    expect(client.isMember('lobby')).toBe(true);
    await client.sendMessage('lobby', { text: 'keep' });
    await client.leaveRoom('lobby');
    expect(client.isMember('lobby')).toBe(false);
    expect(await client.getHistory('lobby')).toHaveLength(0);
  });

  it('attaches an unsigned display name inside ciphertext', async () => {
    const { client, produced } = await createClient();
    client.setDisplayName('  alice  ');
    expect(client.getDisplayName()).toBe('alice');

    await client.joinRoom('lobby');
    await client.sendMessage('lobby', { text: 'hi' });
    const history = await client.getHistory('lobby');

    expect(JSON.stringify(produced())).not.toContain('alice');
    expect(history[0]?.untrustedDisplayName).toBe('alice');
    expect(history[0]?.body.text).toBe('hi');
  });

  it('rotates the room key so later messages use a new epoch', async () => {
    const { client, produced } = await createClient();
    await client.joinRoom('lobby');
    await client.sendMessage('lobby', { text: 'first' });
    const firstEpoch = produced()?.keyEpoch;
    expect(firstEpoch).toBe(1);

    await client.rotateRoomKey('lobby');
    await client.sendMessage('lobby', { text: 'second' });
    expect(produced()?.keyEpoch).toBe(2);
    expect(JSON.stringify(produced())).not.toContain('second');
  });

  it('refuses to rotate a key for a room that is not joined', async () => {
    const { client } = await createClient();
    await expect(client.rotateRoomKey('lobby')).rejects.toThrow(/joining "lobby" first/);
  });
});
