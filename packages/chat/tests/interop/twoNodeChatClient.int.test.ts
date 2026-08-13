/**
 * Two-node ChatClient interop: shared-room convergence + room isolation.
 *
 * In-process libp2p nodes (no worker threads). Clients are always stopped in afterEach.
 */
import { logger } from '@dechat/common';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatClient } from '../../src/ChatClient';
import { createChatClient } from '../../src/node';

const INFO_HASH = 'chat-client-two-node-v1';
const LOBBY = 'lobby';
const SECRET = 'secret-room';
const SETTLE_MS = 20_000;
const ISOLATION_MS = 4_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pickTcpListenAddr = (addrs: readonly string[]): string => {
  const tcp = addrs.find((addr) => addr.includes('/tcp/') && !addr.includes('/ws'));
  if (!tcp) {
    throw new Error(`No TCP listen multiaddr. Got: ${addrs.join(', ')}`);
  }
  return tcp;
};

const waitUntil = async (
  label: string,
  predicate: () => Promise<boolean> | boolean,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const nodeConfig = (bootstrapPeers: readonly string[]) => ({
  discovery: { enableMdns: false },
  network: {
    listenAddrs: ['/ip4/127.0.0.1/tcp/0'],
    bootstrapPeers: [...bootstrapPeers],
  },
});

const stopQuietly = async (client: ChatClient | undefined): Promise<void> => {
  if (!client) return;
  try {
    await client.stop();
  } catch (err) {
    logger.warn('[twoNodeChatClient] stop failed', err);
  }
};

describe('two-node ChatClient', () => {
  let alice: ChatClient | undefined;
  let bob: ChatClient | undefined;

  afterEach(async () => {
    await stopQuietly(bob);
    await stopQuietly(alice);
    alice = undefined;
    bob = undefined;
  });

  it('replicates a shared room and does not store an unjoined room', async () => {
    alice = await createChatClient({
      infoHash: INFO_HASH,
      nodeSeed: 'chat-alice-seed',
      config: nodeConfig([]),
    });
    await alice.start();
    const aliceAddr = pickTcpListenAddr(alice.getListenAddrs());
    logger.info('[twoNodeChatClient] Alice listening', aliceAddr);

    bob = await createChatClient({
      infoHash: INFO_HASH,
      nodeSeed: 'chat-bob-seed',
      config: nodeConfig([aliceAddr]),
    });
    await bob.start();

    await waitUntil(
      'verified peer registry',
      () => alice!.getVerifiedPeers().includes(bob!.peerId) || bob!.getVerifiedPeers().includes(alice!.peerId),
      SETTLE_MS,
    );

    await alice.joinRoom(LOBBY);
    await alice.joinRoom(SECRET);
    await bob.joinRoom(LOBBY);

    await alice.sendMessage(LOBBY, { text: 'hello-lobby' });
    await waitUntil(
      `Bob history for ${LOBBY}`,
      async () => {
        const history = await bob!.getHistory(LOBBY);
        return history.some((message) => message.body.text === 'hello-lobby');
      },
      SETTLE_MS,
    );

    await alice.sendMessage(SECRET, { text: 'hello-secret' });
    await sleep(ISOLATION_MS);
    const bobSecret = await bob.getHistory(SECRET);
    expect(bobSecret).toHaveLength(0);

    const bobLobby = await bob.getHistory(LOBBY);
    expect(bobLobby.some((message) => message.body.text === 'hello-lobby')).toBe(true);
  }, 60_000);
});
