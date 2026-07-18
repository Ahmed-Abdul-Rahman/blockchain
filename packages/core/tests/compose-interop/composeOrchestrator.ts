import { logger } from '@dechat/common';
import { createClient, type RedisClientType } from 'redis';
import type { NodeRunnerInboundMessage, NodeRunnerOutboundMessage } from '../interop/nodeRunner';
import type { WorkerResult } from '../interop/types';
import { addrsKey, cmdKey, evtKey, readyKey, statsKey } from './composeKeys';

export type ComposeOrchestrator = {
  readonly redis: RedisClientType;
  readonly send: (index: number, message: NodeRunnerInboundMessage) => Promise<void>;
  readonly waitReady: (indices: readonly number[], timeoutMs: number) => Promise<void>;
  readonly waitEvent: (index: number, type: string, timeoutMs: number) => Promise<NodeRunnerOutboundMessage>;
  readonly getAddrs: (index: number) => Promise<string[]>;
  readonly getStats: (index: number) => Promise<WorkerResult | undefined>;
  readonly requestStatistics: (index: number, timeoutMs: number) => Promise<WorkerResult>;
  readonly requestHashes: (index: number, timeoutMs: number) => Promise<readonly string[]>;
  readonly requestListenAddrs: (index: number, timeoutMs: number) => Promise<{ peerId: string; addrs: string[] }>;
  readonly close: () => Promise<void>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createComposeOrchestrator = async (redisUrl: string): Promise<ComposeOrchestrator> => {
  const redis = createClient({ url: redisUrl });
  redis.on('error', (error: unknown) => {
    logger.error(`Compose orchestrator Redis error: ${String(error)}`);
  });
  await redis.connect();

  const pending = new Map<number, NodeRunnerOutboundMessage[]>();

  const enqueue = (index: number, message: NodeRunnerOutboundMessage): void => {
    const queue = pending.get(index) ?? [];
    queue.push(message);
    pending.set(index, queue);
  };

  const dequeueType = (index: number, type: string): NodeRunnerOutboundMessage | undefined => {
    const queue = pending.get(index) ?? [];
    const at = queue.findIndex((message) => message.type === type);
    if (at < 0) return undefined;
    const [message] = queue.splice(at, 1);
    pending.set(index, queue);
    return message;
  };

  const send = async (index: number, message: NodeRunnerInboundMessage): Promise<void> => {
    await redis.lPush(cmdKey(index), JSON.stringify(message));
  };

  const waitReady = async (indices: readonly number[], timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const flags = await Promise.all(indices.map((i) => redis.get(readyKey(i))));
      if (flags.every((v) => v === '1')) return;
      await sleep(500);
    }
    throw new Error(`Timeout waiting for ready nodes: ${indices.join(',')}`);
  };

  const waitEvent = async (index: number, type: string, timeoutMs: number): Promise<NodeRunnerOutboundMessage> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const buffered = dequeueType(index, type);
      if (buffered) return buffered;

      const remainingSec = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      const result = await redis.brPop(evtKey(index), Math.min(remainingSec, 5));
      if (!result) continue;
      const message = JSON.parse(result.element) as NodeRunnerOutboundMessage;
      if (message.type === type) return message;
      enqueue(index, message);
    }
    throw new Error(`Timeout waiting for event ${type} from node ${index}`);
  };

  const getAddrs = async (index: number): Promise<string[]> => {
    const raw = await redis.get(addrsKey(index));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  };

  const getStats = async (index: number): Promise<WorkerResult | undefined> => {
    const raw = await redis.get(statsKey(index));
    if (!raw) return undefined;
    return JSON.parse(raw) as WorkerResult;
  };

  const requestStatistics = async (index: number, timeoutMs: number): Promise<WorkerResult> => {
    await send(index, { type: 'statistics' });
    const evt = await waitEvent(index, 'statistics', timeoutMs);
    if (!evt.stats) throw new Error(`Node ${index} statistics event missing stats`);
    return evt.stats;
  };

  const requestHashes = async (index: number, timeoutMs: number): Promise<readonly string[]> => {
    await send(index, { type: 'report_hashes' });
    const evt = await waitEvent(index, 'hashes_report', timeoutMs);
    return evt.hashes ?? [];
  };

  const requestListenAddrs = async (index: number, timeoutMs: number): Promise<{ peerId: string; addrs: string[] }> => {
    await send(index, { type: 'report_listen_addrs' });
    const evt = await waitEvent(index, 'listen_addrs_report', timeoutMs);
    return { peerId: evt.peerId ?? '', addrs: evt.addrs ?? [] };
  };

  const close = async (): Promise<void> => {
    await redis.quit();
  };

  return {
    redis,
    send,
    waitReady,
    waitEvent,
    getAddrs,
    getStats,
    requestStatistics,
    requestHashes,
    requestListenAddrs,
    close,
  };
};
