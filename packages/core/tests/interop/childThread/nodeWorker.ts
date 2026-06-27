import { setTimeout as delay } from 'node:timers/promises';
import { parentPort, threadId, workerData } from 'node:worker_threads';
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Libp2p, Message } from '@libp2p/interface';
import { random } from 'es-toolkit';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { createNode } from '../../../src/node';
import { WorkerData, WorkerResult } from '../types';

const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return -1;
  const i = Math.floor((p / 100) * (xs.length - 1));
  return xs[i];
};

const latencies: number[] = [];
let terminateThread = false;
let pubsub: GossipSub | null = null;
let ttfvp: number | null = null;
let peerExchangeService: PeerExchangeService | null = null;
let checkTimer: NodeJS.Timeout | null = null;
let selfPeerId: string | null = null;

const countOpenUniqueConnections = (node: Libp2p): number => {
  const seen = new Set<string>();
  return node.getConnections().filter(({ remotePeer, status }) => {
    if (status !== 'open') return false;
    const remotePeerId = remotePeer.toString();
    if (seen.has(remotePeerId)) return false;
    seen.add(remotePeerId);
    return true;
  }).length;
};

const getStatistics = (node: Libp2p, pexService: PeerExchangeService, index: number): WorkerResult => ({
  index,
  me: selfPeerId,
  verified: pexService.peerRegistry.getSize(),
  connections: countOpenUniqueConnections(node),
  ttfvpMs: ttfvp ?? -1,
  latencyP50: percentile(latencies, 50),
  latencyP95: percentile(latencies, 95),
  msgsObserved: latencies.length,
});

const subHandler = (evt: CustomEvent<Message>) => {
  try {
    const msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
    if (msg.type === 'ping') {
      const oneWay = Date.now() - msg.ts;
      latencies.push(oneWay);
    }
  } catch {}
};

const registerPubsub = (pubsubTopic: string) => {
  if (!pubsub) return;

  pubsub.subscribe(pubsubTopic);
  // Publish one "hello" when we first get peers
  const t0 = Date.now();
  const checkVerified = () => {
    const size = peerExchangeService?.peerRegistry.getSize();
    if (ttfvp === null && size && size > 0) ttfvp = Date.now() - t0;
  };
  checkTimer = setInterval(checkVerified, 200);

  pubsub.addEventListener('message', subHandler);
};

const terminateAndCleanUp = async (node: Libp2p, stopEngine: () => Promise<void>, workerIndex: number) => {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (!pubsub || !peerExchangeService) return;

  pubsub.removeEventListener('message', subHandler);
  parentPort?.postMessage({ type: 'done', stats: getStatistics(node, peerExchangeService, workerIndex) });

  // Cleanly stop the entire DI container (libp2p, dialQueue, pexService, etc.)
  await stopEngine();

  parentPort?.postMessage({
    type: 'terminate',
    status: 'success',
  });
  await delay(100);
};

const runNode = async () => {
  const args = workerData as WorkerData;
  const { index, nodeSeed, networkId, pubsubTopic, messageRate } = args;

  // 1. Initialize using the nested configuration structure
  const engine = await createNode(networkId, nodeSeed, {
    network: {
      listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
      bootstrapPeers: [],
      maxConnections: 150,
      minConnections: 8,
      maxIncomingPendingConnections: 20,
    },
    discovery: {
      enableMdns: true,
      onBoardingPeerTime: random(1, 10) * 1000 + random(1, 10) * 100,
    },
    metrics: { enabled: true },
  });

  // 2. Destructure from the DI components container
  const node = engine.components.libp2p;
  const pexService = engine.components.pexService;

  // 3. Start all services systematically
  await engine.start();

  selfPeerId = node.peerId.toString();

  console.log('Worker thread: ', threadId, 'and index: ', index, ' started with peerId: ', selfPeerId);

  // Join pubsub topic
  pubsub = node.services.pubsub as GossipSub;
  peerExchangeService = pexService;

  registerPubsub(pubsubTopic);

  parentPort?.on('message', async (message) => {
    if (message.type === 'statistics')
      parentPort?.postMessage({
        type: 'statistics',
        stats: getStatistics(node, pexService, index),
      });
    else if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, engine.stop, index);
      process.exit(0);
    }
  });

  // Send load
  const sendLoop = async () => {
    const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, messageRate)));
    const enc = new TextEncoder();
    while (!terminateThread) {
      await delay(intervalMs);
      const payload = enc.encode(JSON.stringify({ type: 'ping', ts: Date.now(), from: selfPeerId }));
      try {
        if (!pubsub) continue;
        await pubsub.publish(pubsubTopic, payload);
      } catch {}
    }
  };

  await sendLoop();
};

runNode().catch((e) => {
  console.log(`Caught worker ${threadId} error with threadId: `, e);
  parentPort?.postMessage({ type: 'error', error: String(e) });
  process.exit(1);
});
