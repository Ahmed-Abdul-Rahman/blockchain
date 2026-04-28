import { parentPort, threadId, workerData } from 'node:worker_threads';
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { sha256 } from '@dechat/crypto';
import { Libp2p, Message, ServiceMap } from '@libp2p/interface';
import { delay, differenceWith, random } from 'es-toolkit';
import { GossipSubPropagation } from '../../../src/data-propagation/broadcast/GossipSubPropagation';
import { PeerExchangeService } from '../../../src/networking/PeerExchangeService';
import { ReplicaStoreInterface } from '../../../src/replica-store/ReplicaStoreInterface';
import { WorkerData, WorkerResult } from '../types';
import { configureNode, percentile } from './workerUitls';

type GossipMessageA = { message: string };

type GossipMessageB = string;

const GossipPropTopicA = '/deChat/v1/topic/test-chat-a';
const GossipPropTopicB = '/deChat/v1/topic/test-chat-b';
const DirectStreamProtocol = '/deChat/v1/protocol/direct';
const latencies: number[] = [];

let terminateThread = false;
let pubsub: GossipSub | null = null;
let pexService: PeerExchangeService | null = null;
let ttfvp: number | null = null;
let checkTimer: NodeJS.Timeout | null = null;
let selfPeerId: string | null = null;
let directStreamMsgsReceivedCount = 0;
let targetHashesToFetch: string[] | null = null;

const hashedMessages = new Map<string, unknown>();

const getReplicationResult = async (replicaStore: ReplicaStoreInterface) => {
  const generated = hashedMessages.values().toArray();
  const replicated = ((await replicaStore.values()) as readonly Uint8Array[]).map((value) =>
    replicaStore.serializer.deserialize(value),
  );

  const normalize = (val: unknown): string => {
    if (typeof val === 'object' && val !== null && 'message' in val) {
      return (val as GossipMessageA).message;
    }
    return val as string;
  };

  const diff = differenceWith(generated.map(normalize), replicated.map(normalize), (gen, rep) => gen === rep);

  return {
    replicaCount: await replicaStore.size(),
    replicaDataDiff: diff,
    hasTargetData: targetHashesToFetch
      ? (await Promise.all(targetHashesToFetch.map((h) => replicaStore.has(h)))).every(Boolean)
      : undefined,
  };
};

const getStatistics = async (
  node: Libp2p<ServiceMap>,
  pexService: PeerExchangeService,
  propagation: GossipSubPropagation,
  replicaStore?: ReplicaStoreInterface,
): Promise<WorkerResult> => {
  const gossipSeenMessages = propagation.getSeenMessages();

  const replicationResults = replicaStore ? getReplicationResult(replicaStore) : {};

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
    ...replicationResults,
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
    const size = pexService?.peerRegistry.getSize();
    if (ttfvp === null && size && size > 0) ttfvp = Date.now() - t0;
  };
  checkTimer = setInterval(checkVerified, 200);

  pubsub.addEventListener('message', subHandler);
};

const terminateAndCleanUp = async (
  node: Libp2p<ServiceMap>,
  propagation: GossipSubPropagation,
  stopEngine: () => Promise<void>,
  replicaStore?: ReplicaStoreInterface,
) => {
  try {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    if (!pubsub || !pexService) return;

    pubsub.removeEventListener('message', subHandler);
    parentPort?.postMessage({
      type: 'done',
      stats: await getStatistics(node, pexService, propagation, replicaStore),
    });

    await stopEngine();
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

const runNodeDataPropagation = async () => {
  const args = workerData as WorkerData;
  const { pubsubTopic } = args;
  const onBoardingPeerTime = random(1, 10) * 1000 + random(1, 10) * 100;

  const engine = await configureNode(onBoardingPeerTime);

  const node = engine.node;
  const broadcastProp = engine.broadcastProp;
  const directStream = engine.directStream;

  pexService = engine.pexService;

  await engine.start();

  selfPeerId = node.peerId.toString();

  pubsub = engine.nodePubsub;

  registerPubsub(pubsubTopic);

  broadcastProp.subscribe<GossipMessageA>(GossipPropTopicA, (message, ctx) => {});

  broadcastProp.subscribe<GossipMessageB>(GossipPropTopicB, (message, ctx) => {});

  directStream.onReceive<string>(DirectStreamProtocol, (message, ctx) => {
    directStreamMsgsReceivedCount++;
  });

  parentPort?.on('message', async (message) => {
    if (message.type === 'statistics')
      parentPort?.postMessage({
        type: 'statistics',
        stats: await getStatistics(node, engine.pexService, broadcastProp),
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
        engine.pexService.peerRegistry.getPeers().forEach((peerId) => {
          const selfPeerId = node.peerId.toString();
          const payload = `Hello ${j} from ${selfPeerId}`;
          const id = sha256(payload);
          directStream.send(peerId, DirectStreamProtocol, { id, payload, from: selfPeerId, timestamp: Date.now() });
        });
      }
    } else if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, broadcastProp, engine.nodeCleanUp);
      process.exit(0);
    }
  });

  await sendLoop();
};

const runNodeDataReplication = async () => {
  const args = workerData as WorkerData;
  const { pubsubTopic, index } = args;
  const onBoardingPeerTime = random(1, 10) * 1000 + random(1, 10) * 100;

  const engine = await configureNode(onBoardingPeerTime);

  if (!engine.replicaStore || !engine.dataReplication || !engine.contentHasher) return;

  const node = engine.node;
  const dataReplication = engine.dataReplication;
  const broadcastProp = engine.broadcastProp;
  const directStream = engine.directStream;
  const replicaStore = engine.replicaStore;
  const contentHasher = engine.contentHasher;

  pexService = engine.pexService;

  await engine.start();

  selfPeerId = node.peerId.toString();

  pubsub = engine.nodePubsub;

  registerPubsub(pubsubTopic);

  broadcastProp.subscribe<GossipMessageA>(GossipPropTopicA, (message, ctx) => {
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
        stats: await getStatistics(node, engine.pexService, broadcastProp, replicaStore),
      });
    else if (message.type === 'produce_messages_replication') {
      for (let j = 1; j <= 2; j++) {
        const selfPeerId = node.peerId.toString();
        for (let i = 1; i <= 2; i++) {
          const payloadA = {
            message: `Node: ${index} - Topic: ${GossipPropTopicA} - Hello ${i} from: ${selfPeerId}`,
          };
          publisMessage(node, broadcastProp, payloadA, GossipPropTopicA);
          dataReplication.onLocalDataProduced(payloadA);
          await delay(random(1, 10) * 500);
          const payloadB = `Node: ${index} - Topic:${GossipPropTopicB} - Hello ${i} from: ${selfPeerId}`;
          publisMessage(node, broadcastProp, payloadB, GossipPropTopicB);
          dataReplication.onLocalDataProduced(payloadB);
        }
        const payload = `Node: ${index} - Topic: ${DirectStreamProtocol} - Hello ${j} from: ${selfPeerId}`;
        engine.pexService.peerRegistry.getPeers().forEach((peerId) => {
          const id = sha256(payload);
          directStream.send(peerId, DirectStreamProtocol, { id, payload, from: selfPeerId, timestamp: Date.now() });
          hashedMessages.set(id, payload);
        });
        dataReplication.onLocalDataProduced(payload);
      }
    } else if (message.type === 'inject_seed_data') {
      const hashes: string[] = [];
      for (let i = 0; i < 3; i++) {
        const payload = { target: `Iterative Fetch Target Data ${i}`, ts: Date.now(), from: selfPeerId };
        const hash = contentHasher.hash(payload);
        await dataReplication.onLocalDataProduced(payload);
        hashes.push(hash);
      }
      parentPort?.postMessage({ type: 'target_hash_generated', hashes });
    } else if (message.type === 'fetch_target_data') {
      targetHashesToFetch = message.hashes;
      for (const hash of targetHashesToFetch || []) {
        await dataReplication.requestMissingData(hash);
      }
    } else if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, broadcastProp, engine.nodeCleanUp, replicaStore);
      process.exit(0);
    }
  });

  await sendLoop();
};

const args = workerData as WorkerData;
const { testType } = args;

if (testType === 'PROPAGATION')
  runNodeDataPropagation().catch((e) => {
    console.log(`Caught worker ${threadId} error with threadId: `, e);
    parentPort?.postMessage({ type: 'error', error: String(e) });
    process.exit(1);
  });
else if (testType === 'REPLICATION')
  runNodeDataReplication().catch((e) => {
    console.log(`Caught worker ${threadId} error with threadId: `, e);
    parentPort?.postMessage({ type: 'error', error: String(e) });
    process.exit(1);
  });
