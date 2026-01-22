import { parentPort, threadId, workerData } from 'node:worker_threads';
import { GossipSub } from '@chainsafe/libp2p-gossipsub/dist/src';
import { sha256 } from '@dechat/crypto';
import { Libp2p, Message, ServiceMap } from '@libp2p/interface';
import { delay, random } from 'es-toolkit';
import { GossipSubPropagation } from '../../src/data-propagation/GossipSubPropagation';
import { PeerExchangeService } from '../../src/networking/PeerExchangeService';
import { createNode } from '../../src/node';
import { WorkerData } from './types';

export type GossipMessage = { message: string };

const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return -1;
  const i = Math.floor((p / 100) * (xs.length - 1));
  return xs[i];
};

const GossipPropTopic = '/deChat/v1/test-chat';
const latencies: number[] = [];

let terminateThread = false;
let pubsub: GossipSub | null = null;
let ttfvp: number | null = null;
let peerExchangeService: PeerExchangeService | null = null;
let checkTimer: NodeJS.Timeout | null = null;
let selfPeerId: string | null = null;

const getStatistics = (
  node: Libp2p<ServiceMap>,
  pexService: PeerExchangeService,
  propagation: GossipSubPropagation<GossipMessage>,
) => ({
  me: selfPeerId,
  verified: pexService.peerRegistry.getSize(),
  connections: node.getConnections().length,
  ttfvpMs: ttfvp ?? -1,
  latencyP50: percentile(latencies, 50),
  latencyP95: percentile(latencies, 95),
  msgsObserved: latencies.length,
  seenMessages: propagation.getSeenMessages().get(GossipPropTopic)?.size,
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

const terminateAndCleanUp = async (node: Libp2p<ServiceMap>, propagation: GossipSubPropagation<GossipMessage>) => {
  if (checkTimer) clearInterval(checkTimer);
  if (!pubsub || !peerExchangeService) return;

  pubsub.removeEventListener('message', subHandler);
  parentPort?.postMessage({ type: 'done', stats: getStatistics(node, peerExchangeService, propagation) });

  await node.stop();
  parentPort?.postMessage({
    type: 'terminate',
    status: 'success',
  });
  delay(100);
};

const publisMessage = (node: Libp2p, propagation: GossipSubPropagation<GossipMessage>, message: GossipMessage) => {
  const id = sha256(JSON.stringify(message));
  console.log(threadId, 'message id: ', id);
  propagation.publish(GossipPropTopic, {
    payload: message,
    id,
    from: node.peerId.toString(),
    timestamp: Date.now(),
  });
};

const runNode = async () => {
  const args = workerData as WorkerData;
  const { index, nodeSeed, networkId, pubsubTopic, messageRate } = args;

  // Start your node factory with mdns disabled for determinism (optional)
  const { node, pexService, nodeCleanUp } = await createNode(networkId, nodeSeed, {
    mdns: true,
    listenTcp: ['/ip4/127.0.0.1/tcp/0'],
    // bootstrap: bootstrapMultiaddrs, // make your node.ts honor this
    onBoardingPeerTime: Math.random() * 10 * 1000,
  });

  const propagation = new GossipSubPropagation<GossipMessage>(node);

  await node.start();

  selfPeerId = node.peerId.toString();

  console.log('Wroker thread: ', threadId, 'and index: ', index, ' started with peerId: ', selfPeerId);

  // Join pubsub topic
  pubsub = node.services.pubsub as GossipSub;
  peerExchangeService = pexService;

  registerPubsub(pubsubTopic);
  propagation.subscribe(GossipPropTopic, (message, ctx) => {});

  parentPort?.on('message', async (message) => {
    if (message.type === 'statistics')
      parentPort?.postMessage({
        type: 'statistics',
        stats: getStatistics(node, pexService, propagation),
      });
    else if (message.type === 'produce_messages') {
      for (let j = 0; j < 2; j++) {
        for (let i = 1; i <= 2; i++) {
          const payload = { message: `Hello ${i} from: ${node.peerId.toString()}` };
          publisMessage(node, propagation, payload);
          await delay(random(1, 10) * 500);
        }
      }
    } else if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, propagation);
      nodeCleanUp();
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
