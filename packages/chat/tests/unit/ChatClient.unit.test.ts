/** biome-ignore-all lint/suspicious/noExplicitAny: test doubles */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatClientImpl } from '../../src/ChatClient';
import { ChatMessageEnvelope } from '../../src/domain/types';

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

  it('joins a room, sends a chat envelope, and projects history', async () => {
    const stored = new Map<string, Uint8Array>();
    let produced: ChatMessageEnvelope | undefined;
    const scope = {
      joinRoom: vi.fn().mockResolvedValue(undefined),
      leaveRoom: vi.fn().mockResolvedValue(undefined),
      produce: vi.fn(async (_room: string, data: ChatMessageEnvelope) => {
        produced = data;
        const hash = 'h-msg';
        stored.set(hash, jsonSerializer.serialize(data));
        return hash;
      }),
      getRoomHashes: vi.fn(() => ['h-msg']),
      subscribe: vi.fn(() => () => undefined),
      isMember: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      syncRoom: vi.fn(),
    };

    const client = new ChatClientImpl({
      components: {
        libp2p: {
          peerId: { toString: () => 'self-peer' },
          getMultiaddrs: () => [{ toString: () => '/ip4/127.0.0.1/tcp/4001/p2p/self-peer' }],
        },
        peerRegistry: { getPeers: () => ['other-peer'] },
        serializer: jsonSerializer,
        strategies: {
          roomScope: scope,
          replicaStore: {
            get: async (hash: string) => stored.get(hash) ?? null,
          },
        },
      },
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    } as any);

    await client.start();
    await client.joinRoom('lobby');
    const hash = await client.sendMessage('lobby', { text: 'hello' });
    const history = await client.getHistory('lobby');
    await client.stop();

    expect(hash).toBe('h-msg');
    expect(scope.joinRoom).toHaveBeenCalledWith('lobby');
    expect(produced?.type).toBe('chat_message');
    expect(produced?.roomId).toBe('lobby');
    expect(produced?.senderPeerId).toBe('self-peer');
    expect(produced?.body.text).toBe('hello');
    expect(history).toHaveLength(1);
    expect(history[0]?.body.text).toBe('hello');
    expect(client.getListenAddrs()).toEqual(['/ip4/127.0.0.1/tcp/4001/p2p/self-peer']);
    expect(client.getVerifiedPeers()).toEqual(['other-peer']);
  });
});
