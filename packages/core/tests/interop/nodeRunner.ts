import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { sha256 } from '@dechat/crypto';
import { Libp2p, Message, ServiceMap } from '@libp2p/interface';
import { multiaddr } from '@multiformats/multiaddr';
import { delay, differenceWith, random } from 'es-toolkit';
import type { AntiEntropyMetricsSnapshot } from '../../src/data-convergence/scheduling/AntiEntropyMetricsStore';
import { AntiEntropyMetricsStore } from '../../src/data-convergence/scheduling/AntiEntropyMetricsStore';
import { GossipSubPropagation } from '../../src/data-propagation/broadcast/GossipSubPropagation';
import { PeerExchangeService } from '../../src/networking/PeerExchangeService';
import { ReplicaStoreInterface } from '../../src/replica-store/ReplicaStoreInterface';
import { WireCodec } from '../../src/shared/serialization/types';
import { installReplicationProtocolIngestGate } from './childThread/replicationIngestGate';
import { configureNode, percentile } from './childThread/workerUitls';
import { WorkerData, WorkerResult } from './types';

type GossipMessageA = { message: string };
type GossipMessageB = string;

const GossipPropTopicA = '/deChat/v1/topic/test-chat-a';
const GossipPropTopicB = '/deChat/v1/topic/test-chat-b';
const DirectStreamProtocol = '/deChat/v1/protocol/direct';

/** Inbound control messages from the orchestrator (worker parent or Compose Redis). */
export type NodeRunnerInboundMessage = {
  readonly type: string;
  readonly hashes?: string[];
  readonly multiaddrs?: string[];
};

/** Outbound events toward the orchestrator. */
export type NodeRunnerOutboundMessage = {
  readonly type: string;
  readonly stats?: WorkerResult;
  readonly status?: string;
  readonly hashes?: readonly string[];
  readonly index?: number;
  readonly peerId?: string;
  readonly addrs?: string[];
  readonly error?: string;
};

/**
 * Transport seam for nodeRunner — worker threads use parentPort; Compose will use Redis.
 * Must not embed transport-specific addressing logic beyond what the runner already does.
 */
export type NodeRunnerTransport = {
  readonly onMessage: (handler: (message: NodeRunnerInboundMessage) => void | Promise<void>) => void;
  readonly postMessage: (message: NodeRunnerOutboundMessage) => void;
  readonly exit: (code: number) => void;
};

export type NodeRunnerOptions = {
  /** Label for dial/debug logs (e.g. `Worker 3` or `compose:2`). */
  readonly logLabel?: string;
};

export const mapAntiEntropySnapshot = (
  snapshot: AntiEntropyMetricsSnapshot,
  convergenceMs?: number,
): NonNullable<WorkerResult['antiEntropy']> => ({
  outboundAttempts: snapshot.outboundAttempts,
  usefulSyncs: snapshot.usefulSyncs,
  lastSyncHashes: snapshot.lastSyncHashes,
  idleSkips: snapshot.skipCounts.idle_skip,
  floorSyncForces: snapshot.skipCounts.floor_sync_forced,
  scheduledTicks: snapshot.scheduledTicks,
  zeroHashStreak: snapshot.consecutiveZeroHashComplete,
  activityScore: snapshot.stateVector[5],
  ...(convergenceMs !== undefined ? { convergenceMs } : {}),
});

/**
 * Adapts a worker_threads MessagePort-like channel to {@link NodeRunnerTransport}.
 */
export const createWorkerThreadTransport = (
  port: {
    on: (event: 'message', listener: (message: NodeRunnerInboundMessage) => void) => void;
    postMessage: (message: NodeRunnerOutboundMessage) => void;
  },
  exitFn: (code: number) => void,
): NodeRunnerTransport => ({
  onMessage: (handler) => {
    port.on('message', (message) => {
      void Promise.resolve(handler(message)).catch((error: unknown) => {
        logger.error(`nodeRunner transport handler failed: ${String(error)}`);
      });
    });
  },
  postMessage: (message) => {
    port.postMessage(message);
  },
  exit: exitFn,
});

/**
 * Shared interop node lifecycle + command handlers.
 * Used by worker threads today; Compose containers will call the same entry with a Redis transport.
 */
export const startNodeRunner = async (
  config: WorkerData,
  transport: NodeRunnerTransport,
  options: NodeRunnerOptions = {},
): Promise<void> => {
  const logLabel = options.logLabel ?? `node:${config.index}`;
  const { testType } = config;

  if (testType === 'PROPAGATION') {
    await runNodeDataPropagation(config, transport, logLabel);
    return;
  }

  if (testType === 'REPLICATION') {
    await runNodeDataReplication(config, transport, logLabel);
    return;
  }

  throw new Error(`Unsupported nodeRunner testType: ${String(testType)}`);
};

const runNodeDataPropagation = async (
  config: WorkerData,
  transport: NodeRunnerTransport,
  _logLabel: string,
): Promise<void> => {
  const latencies: number[] = [];
  let terminateThread = false;
  let pubsub: GossipSub | null = null;
  let pexService: PeerExchangeService | null = null;
  let ttfvp: number | null = null;
  let checkTimer: NodeJS.Timeout | null = null;
  let selfPeerId: string | null = null;
  let directStreamMsgsReceivedCount = 0;
  let wireSerializer: WireCodec | null = null;

  const hashedMessages = new Map<string, unknown>();

  const getStatistics = async (
    node: Libp2p<ServiceMap>,
    peerExchange: PeerExchangeService,
    propagation: GossipSubPropagation,
  ): Promise<WorkerResult> => {
    const gossipSeenMessages = propagation.getSeenMessages();
    return {
      me: selfPeerId,
      verified: peerExchange.peerRegistry.getSize(),
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
    };
  };

  const subHandler = (evt: CustomEvent<Message>) => {
    try {
      if (!wireSerializer) return;
      const msg = wireSerializer.deserialize<{ type: string; ts: number }>(evt.detail.data);
      if (msg.type === 'ping') {
        latencies.push(Date.now() - msg.ts);
      }
    } catch {
      /* ignore malformed ping payloads */
    }
  };

  const registerPubsub = (pubsubTopic: string) => {
    if (!pubsub) return;
    pubsub.subscribe(pubsubTopic);
    const t0 = Date.now();
    checkTimer = setInterval(() => {
      const size = pexService?.peerRegistry.getSize();
      if (ttfvp === null && size && size > 0) ttfvp = Date.now() - t0;
    }, 200);
    pubsub.addEventListener('message', subHandler);
  };

  const terminateAndCleanUp = async (
    node: Libp2p<ServiceMap>,
    propagation: GossipSubPropagation,
    stopEngine: () => Promise<void>,
  ) => {
    try {
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }
      if (!pubsub || !pexService) return;

      pubsub.removeEventListener('message', subHandler);
      transport.postMessage({
        type: 'done',
        stats: await getStatistics(node, pexService, propagation),
      });
      await stopEngine();
      transport.postMessage({ type: 'terminate', status: 'success' });
      await delay(100);
    } catch (error) {
      console.log('Error occurred while terminateAndCleanUp ', error);
    }
  };

  const publishMessage = (
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
    const { pubsubTopic, messageRate } = config;
    const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, messageRate)));
    while (!terminateThread) {
      await delay(intervalMs);
      if (!pubsub || !wireSerializer) continue;
      const payload = wireSerializer.serialize({ type: 'ping', ts: Date.now(), from: selfPeerId });
      try {
        await pubsub.publish(pubsubTopic, payload);
      } catch {
        /* ignore publish races during teardown */
      }
    }
  };

  const { pubsubTopic } = config;
  const onBoardingPeerTime = random(1, 10) * 1000 + random(1, 10) * 100;
  const engine = await configureNode(config, onBoardingPeerTime);

  const node = engine.node;
  const broadcastProp = engine.broadcastProp;
  const directStream = engine.directStream;

  pexService = engine.pexService;
  wireSerializer = engine.serializer;

  await engine.start();
  selfPeerId = node.peerId.toString();
  pubsub = engine.nodePubsub;
  registerPubsub(pubsubTopic);

  broadcastProp.subscribe<GossipMessageA>(GossipPropTopicA, () => {});
  broadcastProp.subscribe<GossipMessageB>(GossipPropTopicB, () => {});
  directStream.onReceive<string>(DirectStreamProtocol, () => {
    directStreamMsgsReceivedCount++;
  });

  transport.onMessage(async (message) => {
    if (message.type === 'statistics') {
      transport.postMessage({
        type: 'statistics',
        stats: await getStatistics(node, engine.pexService, broadcastProp),
      });
      return;
    }

    if (message.type === 'produce_messages') {
      for (let j = 1; j <= 2; j++) {
        for (let i = 1; i <= 2; i++) {
          const payloadA = { message: `Hello ${i} from: ${node.peerId.toString()}` };
          publishMessage(node, broadcastProp, payloadA, GossipPropTopicA);
          await delay(random(1, 10) * 500);
          const payloadB = `Hello ${i} from: ${node.peerId.toString()}`;
          publishMessage(node, broadcastProp, payloadB, GossipPropTopicB);
        }
        engine.pexService.peerRegistry.getPeers().forEach((peerId) => {
          const from = node.peerId.toString();
          const payload = `Hello ${j} from ${from}`;
          const id = sha256(payload);
          directStream.send(peerId, DirectStreamProtocol, { id, payload, from, timestamp: Date.now() });
        });
      }
      return;
    }

    if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, broadcastProp, engine.nodeCleanUp);
      transport.exit(0);
    }
  });

  await sendLoop();
};

const runNodeDataReplication = async (
  config: WorkerData,
  transport: NodeRunnerTransport,
  logLabel: string,
): Promise<void> => {
  const latencies: number[] = [];
  let terminateThread = false;
  let pubsub: GossipSub | null = null;
  let pexService: PeerExchangeService | null = null;
  let ttfvp: number | null = null;
  let checkTimer: NodeJS.Timeout | null = null;
  let selfPeerId: string | null = null;
  let directStreamMsgsReceivedCount = 0;
  let targetHashesToFetch: string[] | null = null;
  let wireSerializer: WireCodec | null = null;
  let antiEntropyMetrics: AntiEntropyMetricsStore | undefined;
  let convergenceWatchStartedAt: number | null = null;
  let convergenceMsRecorded: number | null = null;

  const hashedMessages = new Map<string, unknown>();
  const { pubsubTopic, index } = config;

  const getReplicationResult = async (store: ReplicaStoreInterface) => {
    const generated = hashedMessages.values().toArray();
    const replicated = ((await store.values()) as readonly Uint8Array[]).map((value) =>
      store.serializer.deserialize(value),
    );

    const normalize = (val: unknown): string => {
      if (typeof val === 'object' && val !== null && 'message' in val) {
        return (val as GossipMessageA).message;
      }
      return val as string;
    };

    const diff = differenceWith(generated.map(normalize), replicated.map(normalize), (gen, rep) => gen === rep);

    const hasTargetData = targetHashesToFetch
      ? (await Promise.all(targetHashesToFetch.map((h) => store.has(h)))).every(Boolean)
      : undefined;

    if (hasTargetData && convergenceWatchStartedAt !== null && convergenceMsRecorded === null) {
      convergenceMsRecorded = Date.now() - convergenceWatchStartedAt;
    }

    return {
      replicaCount: await store.size(),
      replicaDataDiff: diff,
      hasTargetData,
    };
  };

  const getStatistics = async (
    node: Libp2p<ServiceMap>,
    peerExchange: PeerExchangeService,
    propagation: GossipSubPropagation,
    store?: ReplicaStoreInterface,
  ): Promise<WorkerResult> => {
    const gossipSeenMessages = propagation.getSeenMessages();
    const replicationResults = store ? await getReplicationResult(store) : {};

    const antiEntropySnapshot = antiEntropyMetrics?.snapshot();
    const convergenceMs =
      convergenceMsRecorded ??
      (antiEntropySnapshot &&
      convergenceWatchStartedAt !== null &&
      'hasTargetData' in replicationResults &&
      replicationResults.hasTargetData
        ? Date.now() - convergenceWatchStartedAt
        : undefined);

    return {
      me: selfPeerId,
      verified: peerExchange.peerRegistry.getSize(),
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
      ...(antiEntropySnapshot
        ? {
            antiEntropy: mapAntiEntropySnapshot(antiEntropySnapshot, convergenceMs),
          }
        : {}),
      ...replicationResults,
    };
  };

  const subHandler = (evt: CustomEvent<Message>) => {
    try {
      if (!wireSerializer) return;
      const msg = wireSerializer.deserialize<{ type: string; ts: number }>(evt.detail.data);
      if (msg.type === 'ping') {
        latencies.push(Date.now() - msg.ts);
      }
    } catch {
      /* ignore malformed ping payloads */
    }
  };

  const registerPubsub = (topic: string) => {
    if (!pubsub) return;
    pubsub.subscribe(topic);
    const t0 = Date.now();
    checkTimer = setInterval(() => {
      const size = pexService?.peerRegistry.getSize();
      if (ttfvp === null && size && size > 0) ttfvp = Date.now() - t0;
    }, 200);
    pubsub.addEventListener('message', subHandler);
  };

  const terminateAndCleanUp = async (
    node: Libp2p<ServiceMap>,
    propagation: GossipSubPropagation,
    stopEngine: () => Promise<void>,
    store?: ReplicaStoreInterface,
  ) => {
    try {
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }
      if (!pubsub || !pexService) return;

      pubsub.removeEventListener('message', subHandler);
      transport.postMessage({
        type: 'done',
        stats: await getStatistics(node, pexService, propagation, store),
      });
      await stopEngine();
      transport.postMessage({ type: 'terminate', status: 'success' });
      await delay(100);
    } catch (error) {
      console.log('Error occurred while terminateAndCleanUp ', error);
    }
  };

  const publishMessage = (
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
    const { messageRate } = config;
    const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, messageRate)));
    while (!terminateThread) {
      await delay(intervalMs);
      if (!pubsub || !wireSerializer) continue;
      const payload = wireSerializer.serialize({ type: 'ping', ts: Date.now(), from: selfPeerId });
      try {
        await pubsub.publish(pubsubTopic, payload);
      } catch {
        /* ignore publish races during teardown */
      }
    }
  };

  const onBoardingPeerTime = random(1, 10) * 1000 + random(1, 10) * 100;
  const engine = await configureNode(config, onBoardingPeerTime);

  if (!engine.replicaStore || !engine.dataReplication || !engine.contentHasher) return;

  const node = engine.node;
  const dataReplication = engine.dataReplication;
  const broadcastProp = engine.broadcastProp;
  const directStream = engine.directStream;
  const store = engine.replicaStore;
  const contentHasher = engine.contentHasher;

  pexService = engine.pexService;
  wireSerializer = engine.serializer;
  antiEntropyMetrics = engine.antiEntropyMetrics;

  const passiveReplicationSuppressed = config.suppressReplicationIngest === true;
  let replicationIngestEnabled = !passiveReplicationSuppressed;

  const ingestRemoteData = async <T>(data: T, fromPeer: string): Promise<void> => {
    if (!replicationIngestEnabled) return;
    await dataReplication.onRemoteDataReceived(data, fromPeer);
  };

  if (passiveReplicationSuppressed) {
    installReplicationProtocolIngestGate(dataReplication, () => replicationIngestEnabled);
  }

  await engine.start();
  selfPeerId = node.peerId.toString();
  pubsub = engine.nodePubsub;
  registerPubsub(pubsubTopic);

  broadcastProp.subscribe<GossipMessageA>(GossipPropTopicA, (message, ctx) => {
    void ingestRemoteData(message.payload, ctx.from.toString());
    hashedMessages.set(message.id, message.payload);
  });

  broadcastProp.subscribe<GossipMessageB>(GossipPropTopicB, (message, ctx) => {
    void ingestRemoteData(message.payload, ctx.from.toString());
    hashedMessages.set(message.id, message.payload);
  });

  directStream.onReceive<string>(DirectStreamProtocol, (message, ctx) => {
    directStreamMsgsReceivedCount++;
    void ingestRemoteData(message.payload, ctx.from.toString());
    hashedMessages.set(message.id, message.payload);
  });

  transport.onMessage(async (message) => {
    if (message.type === 'statistics') {
      transport.postMessage({
        type: 'statistics',
        stats: await getStatistics(node, engine.pexService, broadcastProp, store),
      });
      return;
    }

    if (message.type === 'produce_messages_replication') {
      for (let j = 1; j <= 2; j++) {
        const from = node.peerId.toString();
        for (let i = 1; i <= 2; i++) {
          const payloadA = {
            message: `Node: ${index} - Topic: ${GossipPropTopicA} - Hello ${i} from: ${from}`,
          };
          publishMessage(node, broadcastProp, payloadA, GossipPropTopicA);
          dataReplication.onLocalDataProduced(payloadA);
          await delay(random(1, 10) * 500);
          const payloadB = `Node: ${index} - Topic:${GossipPropTopicB} - Hello ${i} from: ${from}`;
          publishMessage(node, broadcastProp, payloadB, GossipPropTopicB);
          dataReplication.onLocalDataProduced(payloadB);
        }
        const payload = `Node: ${index} - Topic: ${DirectStreamProtocol} - Hello ${j} from: ${from}`;
        engine.pexService.peerRegistry.getPeers().forEach((peerId) => {
          const id = sha256(payload);
          directStream.send(peerId, DirectStreamProtocol, { id, payload, from, timestamp: Date.now() });
          hashedMessages.set(id, payload);
        });
        dataReplication.onLocalDataProduced(payload);
      }
      return;
    }

    if (message.type === 'inject_seed_data') {
      const hashes: string[] = [];
      for (let i = 0; i < 3; i++) {
        const payload = { target: `Iterative Fetch Target Data ${i}`, ts: Date.now(), from: selfPeerId };
        const hash = contentHasher.hash(payload);
        await dataReplication.onLocalDataProduced(payload);
        hashes.push(hash);
      }
      transport.postMessage({ type: 'target_hash_generated', hashes });
      return;
    }

    if (message.type === 'fetch_target_data') {
      targetHashesToFetch = message.hashes ?? null;
      for (const hash of targetHashesToFetch ?? []) {
        await dataReplication.requestMissingData(hash);
      }
      return;
    }

    if (message.type === 'report_hashes') {
      const hashes = (await store.keys()) as readonly string[];
      transport.postMessage({ type: 'hashes_report', index, hashes });
      return;
    }

    if (message.type === 'report_listen_addrs') {
      const peerId = node.peerId.toString();
      const addrs = node
        .getMultiaddrs()
        .map((addr) => addr.toString().replace('/ip4/0.0.0.0/', '/ip4/127.0.0.1/'))
        .filter((addr) => addr.includes('/ip4/127.0.0.1/'))
        .map((addr) => (addr.includes('/p2p/') ? addr : `${addr}/p2p/${peerId}`));
      transport.postMessage({ type: 'listen_addrs_report', index, peerId, addrs });
      return;
    }

    if (message.type === 'connect_peers') {
      const multiaddrs = message.multiaddrs ?? [];
      const from = node.peerId.toString();

      for (const addrStr of multiaddrs) {
        try {
          const normalized = addrStr.replace('/ip4/0.0.0.0/', '/ip4/127.0.0.1/');
          const ma = multiaddr(normalized);
          const addrPeerId = ma.getPeerId()?.toString();
          if (addrPeerId === from) continue;
          await node.dial(ma);
        } catch (error) {
          logger.debug(`[${logLabel}] Failed to dial ${addrStr}: ${(error as Error).message}`);
        }
      }
      transport.postMessage({ type: 'connect_peers_done', index });
      return;
    }

    if (message.type === 'set_expected_hashes') {
      targetHashesToFetch = message.hashes ?? null;
      convergenceWatchStartedAt = Date.now();
      convergenceMsRecorded = null;
      if (!passiveReplicationSuppressed) {
        replicationIngestEnabled = true;
      }
      return;
    }

    if (message.type === 'terminate') {
      terminateThread = true;
      await terminateAndCleanUp(node, broadcastProp, engine.nodeCleanUp, store);
      transport.exit(0);
    }
  });

  await sendLoop();
};
