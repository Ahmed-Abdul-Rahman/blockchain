import { logger } from '@dechat/common';
import { Stream } from '@libp2p/interface';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

export const now = (): number => Date.now();

/**
 * Writes a message to Stream
 * @param stream
 * @param message
 * @returns
 */
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

/**
 * Reads a single message from stream
 * @param stream
 * @param maxDataLength - Max size in bytes. Defaults to 4MB if undefined.
 * @returns
 */
export const readFromStream = async (stream: Stream, maxDataLength?: number): Promise<unknown> => {
  if (!stream) {
    logger.info('Cannot read from stream as it is null');
    return;
  }
  return await pipe(
    stream.source,
    (source) => lp.decode(source, { maxDataLength }),
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

/**
 * Continually reads messages from a stream as they arrive.
 * @param stream
 * @param onMessage
 * @param maxDataLength - Max size per message. Defaults to 4MB if undefined.
 * @returns
 */
export const readMessagesFromStream = async (
  stream: Stream | null,
  onMessage: (msg: unknown) => void,
  maxDataLength: number = 10,
): Promise<void> => {
  if (!stream) {
    logger.info('Cannot read from stream as it is null');
    return;
  }
  return await pipe(
    stream,
    (source) => lp.decode(source, { maxDataLength }),
    (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
    async (source) => {
      for await (const message of source) {
        try {
          const parsed = JSON.parse(message);
          onMessage(parsed);
        } catch (error) {
          logger.warn('Error occured while reading data from stream');
          logger.debug(error);
        }
      }
    },
  );
};
