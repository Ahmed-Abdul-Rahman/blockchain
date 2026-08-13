/**
 * Bootstrap + two ChatClients: both dial the printed bootstrap addrs (TCP and /ws present).
 * After PEX, Alice and Bob share lobby history. Bootstrap does not join the room.
 */
import { logger } from '@dechat/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createBootstrapPeer } from '../../src/bootstrap/createBootstrapPeer';
import { LOCAL_HYBRID_LISTEN_ADDRS, pickTcpListenAddr, pickWsListenAddr } from '../../src/bootstrap/listenAddrs';
import type { ChatClient } from '../../src/ChatClient';
import { createChatClient } from '../../src/node';

const INFO_HASH = 'chat-bootstrap-two-client-v1';
const NETWORK_ID = 'chat-bootstrap-two-client-net';
const LOBBY = 'lobby-via-bootstrap';
const SETTLE_MS = 40_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const meshConfig = {
  peerAuthenticator: { networkId: NETWORK_ID },
  discovery: { enableMdns: false, onBoardingPeerTime: 300 },
  pexService: { gossipIntervalMs: 3_000, pexRequestCooldownMs: 2_000 },
  peerRegistry: { pexRequestCooldownMs: 2_000 },
  dialQueue: { intervalMs: 1_000 },
};

const stopQuietly = async (client: ChatClient | undefined): Promise<void> => {
  if (!client) return;
  try {
    await client.stop();
  } catch (err) {
    logger.warn('[bootstrapTwoClient] stop failed', err);
  }
};

describe('bootstrap + two ChatClients', () => {
  let bootstrap: ChatClient | undefined;
  let alice: ChatClient | undefined;
  let bob: ChatClient | undefined;

  afterEach(async () => {
    await stopQuietly(bob);
    await stopQuietly(alice);
    await stopQuietly(bootstrap);
    bootstrap = undefined;
    alice = undefined;
    bob = undefined;
  });

  it('prints TCP and WS addrs; two clients that dial it converge on a shared room', async () => {
    bootstrap = await createBootstrapPeer({
      infoHash: INFO_HASH,
      nodeSeed: 'chat-bootstrap-seed',
      config: {
        ...meshConfig,
        network: {
          listenAddrs: [...LOCAL_HYBRID_LISTEN_ADDRS],
          bootstrapPeers: [],
        },
      },
    });
    await bootstrap.start();
    const addrs = bootstrap.getListenAddrs();
    const tcp = pickTcpListenAddr(addrs);
    const ws = pickWsListenAddr(addrs);
    logger.info('[bootstrapTwoClient] TCP', tcp);
    logger.info('[bootstrapTwoClient] WS', ws);
    expect(ws).toContain('/ws');

    const clientConfig = {
      ...meshConfig,
      network: {
        listenAddrs: ['/ip4/127.0.0.1/tcp/0'],
        bootstrapPeers: [tcp],
      },
    };

    alice = await createChatClient({
      infoHash: INFO_HASH,
      nodeSeed: 'chat-bootstrap-alice',
      config: clientConfig,
    });
    bob = await createChatClient({
      infoHash: INFO_HASH,
      nodeSeed: 'chat-bootstrap-bob',
      config: clientConfig,
    });
    await alice.start();
    await bob.start();

    await waitUntil(
      'Alice and Bob verified with bootstrap',
      () =>
        alice!.getVerifiedPeers().includes(bootstrap!.peerId) && bob!.getVerifiedPeers().includes(bootstrap!.peerId),
      SETTLE_MS,
    );

    await waitUntil(
      'Alice and Bob discovered each other via PEX',
      () => alice!.getVerifiedPeers().includes(bob!.peerId) && bob!.getVerifiedPeers().includes(alice!.peerId),
      SETTLE_MS,
    );

    await alice.joinRoom(LOBBY);
    await bob.joinRoom(LOBBY);
    await alice.sendMessage(LOBBY, { text: 'hello-via-bootstrap' });

    await waitUntil(
      `Bob history for ${LOBBY} (alicePeers=${alice.getVerifiedPeers().join(',')} bobPeers=${bob.getVerifiedPeers().join(',')})`,
      async () => {
        const history = await bob!.getHistory(LOBBY);
        return history.some((message) => message.body.text === 'hello-via-bootstrap');
      },
      SETTLE_MS,
    );

    expect(bootstrap.isMember(LOBBY)).toBe(false);
  }, 120_000);
});
