import { writeFile, writeFileSync } from 'node:fs';
import { parentPort, threadId, workerData } from 'node:worker_threads';
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { sha256 } from '@dechat/crypto';
import { Libp2p, Message, ServiceMap } from '@libp2p/interface';
import { delay, differenceWith, random } from 'es-toolkit';
import { GossipSubPropagation } from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { InMemoryReplicaStore } from '../../../src/replica-store/InMemoryReplicationStorage';
import { WorkerData, WorkerResult } from '../types';
import { configureNode, percentile } from './workerUitls';

type GossipMessageA = { message: string };

type GossipMessageB = string;

const GossipPropTopicA = '/deChat/v1/test-chat-a';
const GossipPropTopicB = '/deChat/v1/test-chat-b';
const DirectStreamProtocol = '/deChat/v1/direct';
const latencies: number[] = [];

let terminateThread = false;
let pubsub: GossipSub | null = null;
let peerExchangeService: PeerExchangeService | null = null;
let ttfvp: number | null = null;
let checkTimer: NodeJS.Timeout | null = null;
let selfPeerId: string | null = null;
let directStreamMsgsReceivedCount = 0;

const hashedMessages = new Map<string, unknown>();

const getStatistics = async (
  node: Libp2p<ServiceMap>,
  pexService: PeerExchangeService,
  propagation: GossipSubPropagation,
  replicaStore: InMemoryReplicaStore,
): Promise<WorkerResult> => {
  const gossipSeenMessages = propagation.getSeenMessages();

  const generated = hashedMessages.values().toArray();
  const replicated = (await replicaStore.values()).map((value) => replicaStore.serializer.deserialize(value));

  const normalize = (val: unknown): string => {
    if (typeof val === 'object' && val !== null && 'message' in val) {
      return (val as GossipMessageA).message;
    }
    return val as string;
  };

  const diff = differenceWith(generated.map(normalize), replicated.map(normalize), (gen, rep) => gen === rep);

  return {
    me: selfPeerId,
    verified: pexService.peerRegistry.getSize(),
    connections: node.getConnections().length,
    ttfvpMs: ttfvp ?? -1,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    msgsObserved: latencies.length,
    seenMessages: Array.from(gossipSeenMessages.keys()).map((key) => ({
      topic: key,
      seen: gossipSeenMessages.get(key)?.size ?? 0,
    })),
    directStreamMsgsReceivedCount,
    replicaCount: await replicaStore.size(),
    replicaDataDiff: diff,
  };
};

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

const terminateAndCleanUp = async (
  node: Libp2p<ServiceMap>,
  propagation: GossipSubPropagation,
  replicaStore: InMemoryReplicaStore,
) => {
  try {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    if (!pubsub || !peerExchangeService) return;

    pubsub.removeEventListener('message', subHandler);
    propagation.stop();
    parentPort?.postMessage({
      type: 'done',
      stats: await getStatistics(node, peerExchangeService, propagation, replicaStore),
    });

    await node.stop();
    parentPort?.postMessage({
      type: 'terminate',
      status: 'success',
    });
    delay(100);
  } catch (error) {
    console.log('Error occurred while terminateAndCleanUp ', error);
  }
};

const publisMessage = (
  node: Libp2p,
  propagation: GossipSubPropagation,
  message: GossipMessageA | GossipMessageB,
  topic: string,
) => {
  const id = sha256(JSON.stringify(message));
  hashedMessages.set(id, message);
  propagation.publish(topic, {
    payload: message,
    id,
    from: node.peerId.toString(),
    timestamp: Date.now(),
  });
};

const sendLoop = async () => {
  const args = workerData as WorkerData;
  const { pubsubTopic, messageRate } = args;
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

const runNode = async () => {
  const args = workerData as WorkerData;
  const { pubsubTopic } = args;
  const onBoardingPeerTime = random(1, 10) * 1000 + random(1, 10) * 100;

  const { node, pexService, nodePubsub, broadcastProp, directStream, dataReplication, replicaStore, nodeCleanUp } =
    await configureNode(onBoardingPeerTime);

  await node.start();

  selfPeerId = node.peerId.toString();

  pubsub = nodePubsub;
  peerExchangeService = pexService;

  registerPubsub(pubsubTopic);

  broadcastProp.subscribe<GossipMessageA>(GossipPropTopicA, (message, ctx) => {
    // let the replication protocol manager handle replication messages
    dataReplication.onRemoteDataReceived(message.payload, ctx.from.toString());
    hashedMessages.set(message.id, message.payload);
  });

  broadcastProp.subscribe<GossipMessageB>(GossipPropTopicB, (message, ctx) => {
    dataReplication.onRemoteDataReceived(message.payload, ctx.from.toString());
    hashedMessages.set(message.id, message.payload);
  });

  directStream.onReceive<string>(DirectStreamProtocol, (message, ctx) => {
    directStreamMsgsReceivedCount++;
    dataReplication.onRemoteDataReceived(message.payload, ctx.from.toString());
    hashedMessages.set(message.id, message.payload);
  });

  parentPort?.on('message', async (message) => {
    if (message.type === 'statistics')
      parentPort?.postMessage({
        type: 'statistics',
        stats: await getStatistics(node, pexService, broadcastProp, replicaStore),
      });
    else if (message.type === 'produce_messages') {
      for (let j = 1; j <= 2; j++) {
        for (let i = 1; i <= 2; i++) {
          const payloadA = { message: `Hello ${i} from: ${node.peerId.toString()}` };
          publisMessage(node, broadcastProp, payloadA, GossipPropTopicA);
          await delay(random(1, 10) * 500);
          const payloadB = `Hello ${i} from: ${node.peerId.toString()}`;
          publisMessage(node, broadcastProp, payloadB, GossipPropTopicB);
        }
        pexService.peerRegistry.getPeers().forEach((peerId) => {
          const selfPeerId = node.peerId.toString();
          const payload = `Hello ${j} from ${selfPeerId}`;
          const id = sha256(payload);
          directStream.send(peerId, DirectStreamProtocol, { id, payload, from: selfPeerId, timestamp: Date.now() });
        });
      }
    } else if (message.type === 'produce_messages_replication') {
      for (let j = 1; j <= 2; j++) {
        const selfPeerId = node.peerId.toString();
        for (let i = 1; i <= 2; i++) {
          const payloadA = {
            message: `Node: ${threadId - 1} - Topic: ${GossipPropTopicA} - Hello ${i} from: ${selfPeerId}`,
          };
          publisMessage(node, broadcastProp, payloadA, GossipPropTopicA);
          dataReplication.onLocalDataProduced(payloadA);
          await delay(random(1, 10) * 500);
          const payloadB = `Node: ${threadId - 1} - Topic:${GossipPropTopicB} - Hello ${i} from: ${selfPeerId}`;
          publisMessage(node, broadcastProp, payloadB, GossipPropTopicB);
          dataReplication.onLocalDataProduced(payloadB);
        }
        pexService.peerRegistry.getPeers().forEach((peerId) => {
          const payload = `Node: ${threadId - 1} - Topic: ${DirectStreamProtocol} - Hello ${j} from: ${selfPeerId}`;
          const id = sha256(payload);
          directStream.send(peerId, DirectStreamProtocol, { id, payload, from: selfPeerId, timestamp: Date.now() });
          hashedMessages.set(id, payload);
          dataReplication.onLocalDataProduced(payload);
        });
      }
    } else if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, broadcastProp, replicaStore);
      nodeCleanUp();
      process.exit(0);
    }
  });

  await sendLoop();
};

runNode().catch((e) => {
  console.log(`Caught worker ${threadId} error with threadId: `, e);
  parentPort?.postMessage({ type: 'error', error: String(e) });
  process.exit(1);
});
