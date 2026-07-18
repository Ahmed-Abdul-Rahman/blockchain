import { logger } from '@dechat/common';
import type { RedisClientType } from 'redis';
import type { NodeRunnerInboundMessage, NodeRunnerOutboundMessage, NodeRunnerTransport } from '../interop/nodeRunner';
import { cmdKey, evtKey } from './composeKeys';

/**
 * Redis list transport for Compose nodes.
 * Commands: BRPOP `cmd:{index}` · Events: LPUSH `evt:{index}`
 * Uses a dedicated blocking connection so LPUSH is never starved.
 */
export const createRedisNodeTransport = (
  redis: RedisClientType,
  index: number,
  exitFn: (code: number) => void,
): NodeRunnerTransport => {
  let running = true;
  const blocker = redis.duplicate();

  return {
    onMessage: (handler) => {
      void (async () => {
        await blocker.connect();
        while (running) {
          try {
            const result = await blocker.brPop(cmdKey(index), 2);
            if (!result) continue;
            const message = JSON.parse(result.element) as NodeRunnerInboundMessage;
            await handler(message);
          } catch (error) {
            if (!running) return;
            logger.error(`[compose:${index}] Redis BRPOP handler failed: ${String(error)}`);
          }
        }
      })();
    },
    postMessage: (message: NodeRunnerOutboundMessage) => {
      void redis.lPush(evtKey(index), JSON.stringify(message)).catch((error: unknown) => {
        logger.error(`[compose:${index}] Redis LPUSH failed: ${String(error)}`);
      });
    },
    exit: (code) => {
      running = false;
      void blocker.quit().catch(() => undefined);
      exitFn(code);
    },
  };
};
