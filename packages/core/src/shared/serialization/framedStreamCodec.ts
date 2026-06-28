import { logger } from '@dechat/common';
import { generateRandomUUID } from '@dechat/crypto';
import { Stream } from '@libp2p/interface';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { pushable } from 'it-pushable';
import { BaseMessage } from '../types';
import { WireCodec } from './types';

export interface FramedStreamCodec {
  writeToStream(stream: Stream, message: unknown): Promise<void>;
  readFromStream(stream: Stream, maxDataLength?: number): Promise<unknown>;
  readMessagesFromStream(
    stream: Stream | null,
    onMessage: (msg: unknown) => void,
    maxDataLength?: number,
  ): Promise<void>;
  setupRPCStream<T>(
    stream: Stream,
    handleIncomingRequest: (message: T) => T | null | Promise<T | null>,
    requestTimeoutMs?: number,
  ): { sendRequest: (msg: T) => Promise<T> };
}

export const createFramedStreamCodec = (serializer: WireCodec): FramedStreamCodec => {
  const writeToStream = async (stream: Stream, message: unknown): Promise<void> => {
    if (!stream) {
      logger.info('Cannot write to stream as it is null');
      return;
    }
    const frame = serializer.serialize(message);
    await pipe([frame], (source) => lp.encode(source), stream.sink);
  };

  const readFromStream = async (stream: Stream, maxDataLength: number = 4 * 1024 * 1024): Promise<unknown> => {
    if (!stream) {
      logger.info('Cannot read from stream as it is null');
      return;
    }
    return await pipe(
      stream.source,
      (source) => lp.decode(source, { maxDataLength }),
      async (source) => {
        for await (const buffer of source) {
          return serializer.deserialize(buffer.subarray());
        }
      },
    );
  };

  const readMessagesFromStream = async (
    stream: Stream | null,
    onMessage: (msg: unknown) => void,
    maxDataLength: number = 4 * 1024 * 1024,
  ): Promise<void> => {
    if (!stream) {
      logger.info('Cannot read from stream as it is null');
      return;
    }
    await pipe(
      stream.source,
      (source) => lp.decode(source, { maxDataLength }),
      async (source) => {
        for await (const buffer of source) {
          try {
            onMessage(serializer.deserialize(buffer.subarray()));
          } catch (error) {
            logger.warn('Error occured while reading data from stream');
            logger.debug(error);
          }
        }
      },
    );
  };

  const setupRPCStream = <T>(
    stream: Stream,
    handleIncomingRequest: (message: T) => T | null | Promise<T | null>,
    requestTimeoutMs: number = 10000,
  ) => {
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
          async (source) => {
            for await (const buffer of source) {
              const message = serializer.deserialize(buffer.subarray()) as BaseMessage<T>;

              if (message.responseCorrelationId && pendingRequests.has(message.responseCorrelationId)) {
                pendingRequests.get(message.responseCorrelationId)!.resolve(message.payload);
                pendingRequests.delete(message.responseCorrelationId);
              } else {
                const response = await handleIncomingRequest(message.payload);
                if (response) {
                  outboundQueue.push(serializer.serialize({ responseCorrelationId: message.id, payload: response }));
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
        outboundQueue.push(serializer.serialize(fullMessage));

        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.get(id)!.reject(new Error(`Request timeout for message: ${String(msg)}`));
            pendingRequests.delete(id);
          }
        }, requestTimeoutMs);
      });
    };

    return { sendRequest };
  };

  return {
    writeToStream,
    readFromStream,
    readMessagesFromStream,
    setupRPCStream,
  };
};
