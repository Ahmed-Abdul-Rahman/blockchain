import { logger } from '@dechat/common';
import { createClient } from 'redis';
import { type NodeRunnerOutboundMessage, type NodeRunnerTransport, startNodeRunner } from '../interop/nodeRunner';
import type { WorkerData } from '../interop/types';
import { addrsKey, cmdKey, readyKey, statsKey } from './composeKeys';
import { createRedisNodeTransport } from './redisTransport';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
};

const optionalEnv = (name: string, fallback: string): string => process.env[name] ?? fallback;

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

process.on('unhandledRejection', (reason) => {
  logger.warn(`[composeNode] Suppressed unhandledRejection: ${String(reason)}`);
});

const main = async (): Promise<void> => {
  const index = Number(requireEnv('NODE_INDEX'));
  const totalNodes = Number(requireEnv('TOTAL_NODES'));
  const role = requireEnv('ROLE');
  const redisUrl = requireEnv('REDIS_URL');
  const listenPort = Number(optionalEnv('LISTEN_PORT', '4001'));
  const advertiseHost = optionalEnv('ADVERTISE_HOST', `dechat-node-${index}`);
  const networkId = optionalEnv('NETWORK_ID', 'compose-interop');
  const pubsubTopic = optionalEnv('PUBSUB_TOPIC', '/dechat/compose/v1');
  const nodeSeed = optionalEnv('NODE_SEED', `Compose-Node-${index}`);
  const syncIntervalMs = Number(optionalEnv('SYNC_INTERVAL_MS', '15000'));
  const adaptiveEnabled = parseBool(process.env.ADAPTIVE_ENABLED, false);
  const scheduler = optionalEnv('SCHEDULER', 'heuristic') as 'fixed' | 'heuristic' | 'bandit';
  const enableMdns = parseBool(process.env.ENABLE_MDNS, false);
  const suppressReplicationIngest = parseBool(process.env.SUPPRESS_REPLICATION_INGEST, false) || role === 'late-joiner';

  const redis = createClient({ url: redisUrl });
  redis.on('error', (error: unknown) => {
    logger.error(`[compose:${index}] Redis error: ${String(error)}`);
  });
  await redis.connect();

  const baseTransport = createRedisNodeTransport(redis, index, (code) => {
    void redis.quit().finally(() => process.exit(code));
  });

  const transport: NodeRunnerTransport = {
    onMessage: baseTransport.onMessage,
    exit: baseTransport.exit,
    postMessage: (message: NodeRunnerOutboundMessage) => {
      if (message.type === 'done' && message.stats) {
        void redis.set(statsKey(index), JSON.stringify(message.stats));
      }
      if (message.type === 'listen_addrs_report' && message.addrs) {
        void redis.set(addrsKey(index), JSON.stringify(message.addrs));
      }
      baseTransport.postMessage(message);
    },
  };

  const config: WorkerData = {
    index,
    totalNodes,
    nodeSeed,
    networkId,
    pubsubTopic,
    bootstrapMultiaddrs: [],
    runDurationSec: 3600,
    messageRate: 1,
    dataSyncEnabled: true,
    testType: 'REPLICATION',
    replicationType: 'TOPIC_BASED',
    syncIntervalMs,
    adaptive: {
      enabled: adaptiveEnabled,
      scheduler,
      minIntervalMs: Math.min(5_000, syncIntervalMs),
      maxIntervalMs: syncIntervalMs,
    },
    enableMdns,
    suppressReplicationIngest,
    listenAddrs: [`/ip4/0.0.0.0/tcp/${listenPort}`],
    advertiseHost,
  };

  logger.info(
    `[compose:${index}] starting role=${role} host=${advertiseHost} port=${listenPort} adaptive=${adaptiveEnabled}`,
  );

  await startNodeRunner(config, transport, {
    logLabel: `compose:${index}`,
    onReady: async () => {
      await redis.lPush(cmdKey(index), JSON.stringify({ type: 'report_listen_addrs' }));
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await redis.get(addrsKey(index))) break;
        await sleep(100);
      }
      await redis.set(readyKey(index), '1');
      logger.info(`[compose:${index}] ready`);
    },
  });
};

main().catch((error: unknown) => {
  console.error('composeNodeMain failed', error);
  process.exit(1);
});
