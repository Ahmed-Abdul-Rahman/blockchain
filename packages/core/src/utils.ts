import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { Stream } from '@libp2p/interface';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { cloneDeep } from 'lodash-es';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

export const writeToStream = async (stream: Stream, message: unknown): Promise<void> => {
  if (!stream) {
    logger.info('Cannot write to stream as it is null');
    return;
  }
  const serializedMessage = typeof message === 'string' ? message : JSON.stringify(message);

  await pipe(
    [serializedMessage],
    (source) => map(source, (string) => uint8ArrayFromString(string)),
    (source) => lp.encode(source), // Encode with length prefix (so receiving side knows how much data is coming)
    stream.sink,
  );
};

export const readFromStream = async (stream: Stream): Promise<unknown> => {
  if (!stream) {
    logger.info('Cannot read from stream as it is null');
    return;
  }
  return await pipe(
    stream.source,
    (source) => lp.decode(source),
    (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
    async (source) => {
      for await (const message of source) {
        try {
          return JSON.parse(message);
        } catch (error) {
          if (typeof message === 'string') return message;
          else {
            logger.warn('Error occured while reading data from stream');
            logger.debug(error);
          }
        }
      }
    },
  );
};

export const readMessagesFromStream = async (stream: Stream | null): Promise<Partial<object | string>[]> => {
  if (!stream) {
    logger.info('Cannot read from stream as it is null');
    return [];
  }
  return await pipe(
    stream,
    (source) => lp.decode(source),
    (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
    async (source) => {
      const messages: Array<Partial<object | string>> = [];
      for await (const message of source) {
        try {
          messages.push(JSON.parse(message));
        } catch (error) {
          if (typeof message === 'string') messages.push(message);
          else {
            logger.warn('Error occured while reading data from stream');
            logger.debug(error);
          }
        }
      }
      return messages;
    },
  );
};

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

export const sampleList = <T>(array: T[], limit: number): T[] => {
  if (array.length <= limit) return [...array];
  const resultSample: T[] = [];
  const seenItems = new Set<number>();
  while (resultSample.length < limit) {
    const randomIndex = (Math.random() * array.length) | 0;
    if (!seenItems.has(randomIndex)) {
      seenItems.add(randomIndex);
      resultSample.push(cloneDeep(array[randomIndex]));
    }
  }
  return resultSample;
};

export const now = (): number => Date.now();

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
