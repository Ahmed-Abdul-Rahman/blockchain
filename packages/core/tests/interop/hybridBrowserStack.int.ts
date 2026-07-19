/**
 * Hybrid smoke: Node bootstrap (TCP + WS listen) ↔ browser platform stack client (WS + bootstrap).
 *
 * Runs in Node (WebSockets via `ws`) so CI validates the browser stack without Playwright.
 */
import { logger } from '@dechat/common';
import { multiaddr } from '@multiformats/multiaddr';
import { createBrowserNode } from '../../src/browser';
import { antiEntropyManager } from '../../src/data-convergence/AntiEntropyManager';
import { antiEntropyNetworkExchangeEngine } from '../../src/data-convergence/AntiEntropyNetworkExchange';
import { GossipSubPropagation } from '../../src/data-propagation/broadcast/GossipSubPropagation';
import { DirectStreamPropagation } from '../../src/data-propagation/direct/DirectStreamPropagation';
import { Sha256ContentHashStrategy } from '../../src/data-replication/content-hash/Sha256ContentHashStrategy';
import { ReplicationMessageProtocolManager } from '../../src/data-replication/replication-protocol/ReplicationMessageProtocolManager';
import { topicBasedContentHashReplication } from '../../src/data-replication/TopicBasedContentReplication';
import { createNode } from '../../src/node';
import { inMemoryReplicaStore } from '../../src/replica-store/InMemoryReplicaStore';
import type { DeChatStrategies } from '../../src/types';

const INFO_HASH = 'hybrid-browser-stack-v1';
const SETTLE_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fullStrategies = (): DeChatStrategies => ({
  broadcast: (components) => new GossipSubPropagation(components),
  direct: (components) => new DirectStreamPropagation(components),
  contentHasher: () => new Sha256ContentHashStrategy(),
  replicaStore: inMemoryReplicaStore(),
  replicationProtocol: (components) => new ReplicationMessageProtocolManager(components),
  dataReplication: topicBasedContentHashReplication(),
  networkExchanger: antiEntropyNetworkExchangeEngine(),
  antiEntropyManager: antiEntropyManager(),
});

const pickWsBootstrapAddr = (addrs: Array<{ toString: () => string }>): string => {
  const ws = addrs.map((a) => a.toString()).find((a) => a.includes('/ws'));
  if (!ws) {
    throw new Error(`No /ws multiaddr on bootstrap node. Got: ${addrs.map((a) => a.toString()).join(', ')}`);
  }
  return ws;
};

const main = async (): Promise<void> => {
  const bootstrap = await createNode(
    INFO_HASH,
    'hybrid-bootstrap-seed',
    {
      network: {
        listenAddrs: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
        bootstrapPeers: [],
      },
      discovery: { enableMdns: false },
    },
    fullStrategies(),
  );

  await bootstrap.start();
  const bootstrapAddr = pickWsBootstrapAddr(bootstrap.components.libp2p.getMultiaddrs());
  logger.info('Hybrid bootstrap listening at', bootstrapAddr);

  const client = await createBrowserNode(INFO_HASH, 'hybrid-browser-client-seed', {
    config: {
      network: {
        bootstrapPeers: [bootstrapAddr],
        listenAddrs: [],
      },
    },
    strategies: fullStrategies(),
  });

  await client.start();
  logger.info('Hybrid client started; waiting for verified peer registry…');

  const bootstrapPeerId = bootstrap.components.libp2p.peerId.toString();
  const clientPeerId = client.components.libp2p.peerId.toString();

  let registryReady = false;
  const deadline = Date.now() + SETTLE_MS;
  while (Date.now() < deadline) {
    const bootstrapPeers = bootstrap.components.peerRegistry.getPeers();
    const clientPeers = client.components.peerRegistry.getPeers();
    if (bootstrapPeers.includes(clientPeerId) || clientPeers.includes(bootstrapPeerId)) {
      registryReady = true;
      break;
    }
    // Nudge: dial bootstrap peer id if we only have a connection without registry yet
    if (client.components.libp2p.getConnections().length === 0) {
      try {
        await client.components.libp2p.dial(multiaddr(bootstrapAddr));
      } catch {
        /* retry */
      }
    }
    await sleep(500);
  }

  if (!registryReady) {
    await client.stop();
    await bootstrap.stop();
    throw new Error(
      `Hybrid smoke failed: auth/registry not ready. bootstrapRegistry=${bootstrap.components.peerRegistry.getSize()} clientRegistry=${client.components.peerRegistry.getSize()} clientConns=${client.components.libp2p.getConnections().length}`,
    );
  }

  const payload = { message: `hybrid-smoke-${Date.now()}` };
  await bootstrap.components.strategies.dataReplication!.onLocalDataProduced(payload);
  const hash = bootstrap.components.strategies.contentHasher!.hash(payload);

  let replicated = false;
  const syncDeadline = Date.now() + SETTLE_MS;
  while (Date.now() < syncDeadline) {
    if (await client.components.strategies.replicaStore!.has(hash)) {
      replicated = true;
      break;
    }
    await sleep(500);
  }

  await client.stop();
  await bootstrap.stop();

  if (!replicated) {
    throw new Error(`Hybrid smoke failed: content hash ${hash} did not converge to browser-stack client`);
  }

  logger.info('Hybrid browser-stack smoke passed', { hash, bootstrapPeerId, clientPeerId });
  process.exit(0);
};

main().catch(async (err) => {
  logger.error('Hybrid browser-stack smoke failed', err);
  process.exit(1);
});
