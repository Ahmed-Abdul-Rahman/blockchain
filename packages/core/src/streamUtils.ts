import { logger } from '@dechat/common';
import { generateRandomUUID } from '@dechat/crypto';
import { Stream } from '@libp2p/interface';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { pushable } from 'it-pushable';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { BaseMessage } from './types';

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
 * @param maxDataLength - Max size in bytes. Defaults to 4MB.
 * @returns
 */
export const readFromStream = async (stream: Stream, maxDataLength: number = 4 * 1024 * 1024): Promise<unknown> => {
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

/**
 * Setup a bidirectional request response stream mechanism. Can send request and wait for response sequentially.
 * @param stream - libp2p duplex stream instance
 * @param handleIncomingRequest - callback to handleRequests and send back responses, no response will be sent if callback returns null
 * @param requestTimeoutMs - used to wait for response, if timer expires request is rejected and throws an error
 * @returns
 */
export function setupRPCStream<T>(
  stream: Stream,
  handleIncomingRequest: (message: T) => T | null | Promise<T | null>,
  requestTimeoutMs: number = 10000,
) {
  const outboundQueue = pushable<Uint8Array>();

  const pendingRequests = new Map<
    string,
    { resolve: (val: T | PromiseLike<T>) => void; reject: (err: unknown) => void }
  >();

  pipe(outboundQueue, (source) => lp.encode(source), stream.sink).catch((err) =>
    console.error('Error in write pipeline:', err),
  );

  Promise.resolve().then(async () => {
    try {
      await pipe(
        stream.source,
        (source) => lp.decode(source),
        (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
        async (source) => {
          for await (const messageString of source) {
            const message = JSON.parse(messageString) as BaseMessage<T>;

            // It's a RESPONSE to something we asked for
            if (message.responseCorrelationId && pendingRequests.has(message.responseCorrelationId)) {
              pendingRequests.get(message.responseCorrelationId)!.resolve(message.payload);
              pendingRequests.delete(message.responseCorrelationId); // Cleanup
            }
            // It's a new REQUEST from the other side
            else {
              const response = await handleIncomingRequest(message.payload);
              if (response) {
                // Auto-link our response to their original request ID
                outboundQueue.push(
                  uint8ArrayFromString(JSON.stringify({ responseCorrelationId: message.id, payload: response })),
                );
              }
            }
          }
        },
      );
    } catch (err) {
      console.error('Error in read pipeline:', err);
    }
  });

  const sendRequest = (msg: T): Promise<T> => {
    const id = generateRandomUUID();
    const fullMessage = { payload: msg, id } as BaseMessage<T>;

    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });

      outboundQueue.push(uint8ArrayFromString(JSON.stringify(fullMessage)));

      // Adding a timeout here so promises don't hang forever if the peer drops
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.get(id)!.reject(new Error(`Request timeout for message: ${msg}`));
          pendingRequests.delete(id);
        }
      }, requestTimeoutMs);
    });
  };

  return { sendRequest };
}
