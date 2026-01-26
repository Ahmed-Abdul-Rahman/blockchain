import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { Stream } from '@libp2p/interface';
import { cloneDeep } from 'es-toolkit';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

export const processDataFromStream = async (
  stream: Stream,
  onMessage: (message: unknown) => void,
  onError?: (error: unknown) => void,
): Promise<void> => {
  if (!stream) {
    logger.info('Cannot read from stream as it is null');
    return;
  }
  await pipe(
    stream.source,
    (source) => lp.decode(source),
    (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
    async (source) => {
      for await (const message of source) {
        try {
          onMessage(JSON.parse(message));
        } catch (error) {
          if (onError) onError?.(error);
          else {
            logger.warn('Error occured while reading data from stream');
            logger.debug(error);
          }
        }
      }
    },
  );
};

export const trivialSampling = <T>(array: T[], limit: number): number[] => {
  const chosenIndices: number[] = [];
  const seenItems = new Set<number>();
  while (chosenIndices.length < limit) {
    const randIndex = (Math.random() * array.length) | 0;
    if (!seenItems.has(randIndex)) {
      seenItems.add(randIndex);
      chosenIndices.push(randIndex);
    }
  }
  return chosenIndices;
};

export const floydSampling = <T>(array: T[], limit: number): number[] => {
  const chosenIndices: number[] = [];
  const seenItems = new Set<number>();
  const n = array.length;
  for (let j = n - limit; j < n; j++) {
    const randIndex = Math.floor(Math.random() * (j + 1));
    if (!seenItems.has(randIndex)) {
      seenItems.add(randIndex);
      chosenIndices.push(randIndex);
    } else {
      seenItems.add(j);
      chosenIndices.push(j);
    }
  }
  return chosenIndices;
};

export const sampleList = <T>(array: T[], limit: number): T[] => {
  if (array.length <= limit) return [...array];
  const chosenIndices = floydSampling(array, limit);
  return chosenIndices.map((index) => cloneDeep(array[index]));
};

export const sleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

export const filterAddrs = (addrs: string[]): string[] => (addrs || []).slice(0, 4);

export const publishWithRetry = async (
  pubsub: GossipSub,
  topic: string,
  data: Uint8Array,
  opts: { retries: number; baseDelay: number },
): Promise<void> => {
  const retries = opts.retries;
  const baseDelay = opts.baseDelay;
  for (let i = 0; i < retries; i++) {
    try {
      await pubsub.publish(topic, data);
      return;
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes('PublishError.NoPeersSubscribedToTopic') || msg.includes('NoPeersSubscribedToTopic')) {
        const backoff = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 200);
        logger.info('NoPeersSubscribedToTopic error retrying again in: ', backoff, 'ms');
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error('publishWithRetry: exhausted retries');
};
