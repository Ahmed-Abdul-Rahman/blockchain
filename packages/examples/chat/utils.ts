import { Stream } from '@libp2p/interface';
import { lpStream } from '@libp2p/utils';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { pushable } from 'it-pushable';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { AntiEntropyMessage, BaseMessage } from './types';

export async function* sendData() {
  for (let i = 1; i <= 5; i++) {
    console.log('Dialer Sending Data', i);
    yield uint8ArrayFromString(`${i}`);
    // await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function* transformData(source) {
  for await (const data of source) {
    const string = uint8ArrayToString(data.subarray());
    const dataTransformed = (Number(string) * 2).toString();

    console.log(dataTransformed);
    yield uint8ArrayFromString(dataTransformed);
  }
}

export async function readData(source) {
  for await (const data of source) {
    const string = uint8ArrayToString(data.subarray());
    console.log(`${string}`);
  }
}

export function stdinToStream(stream) {
  // Encode with length prefix (so receiving side knows how much data is coming)
  const lp = lpStream(stream);

  process.stdin.addListener('data', (buf) => {
    lp.write(buf);
  });
}

export function streamToConsole(stream) {
  const lp = lpStream(stream);

  Promise.resolve().then(async () => {
    while (true) {
      // Read from the stream
      const message = await lp.read();

      // Output the data as a utf8 string
      console.log('> ' + uint8ArrayToString(message.subarray()).replace('\n', ''));
    }
  });
}

/**
 * Writes a message to Stream
 * @param stream
 * @param message
 * @returns
 */
export const writeToStream = async (stream: Stream, message: unknown): Promise<void> => {
  if (!stream) {
    console.info('Cannot write to stream as it is null');
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
    console.info('Cannot read from stream as it is null');
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
            console.warn('Error occured while reading data from stream');
            console.debug(error);
          }
        }
      }
    },
  );
};

export function setupBidirectionalStream(
  stream: Stream,
  handleStreamData: (message: string) => BaseMessage<AntiEntropyMessage> | null,
) {
  // 1. Create a pushable queue for OUTBOUND messages
  // Whatever we push into this queue will be sent over the network
  const outboundQueue = pushable<Uint8Array>();

  // 2. Setup the WRITE pipeline (Local Queue -> Network)
  pipe(
    outboundQueue, // The source (our pushable queue)
    // (source) => map(source, (msg) => msg), // Convert string to bytes
    (source) => lp.encode(source), // Add length prefix
    stream.sink, // The sink (the network stream)
  ).catch((err) => console.error('Error in write pipeline:', err));

  // 3. Setup the READ pipeline (Network -> Local Console/Logic)
  Promise.resolve().then(async () => {
    try {
      await pipe(
        stream.source, // The source (the network stream)
        (source) => lp.decode(source), // Decode length prefix
        (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())), // Convert bytes to string
        async (source) => {
          // Consume the incoming messages as they arrive
          for await (const message of source) {
            const response = handleStreamData(message);

            // Example of simultaneously responding to a specific request:
            if (response) {
              outboundQueue.push(uint8ArrayFromString(JSON.stringify(response)));
            }
          }
        },
      );
    } catch (err) {
      console.error('Error in read pipeline:', err);
    }
  });

  // Return the queue so the parent file can push data to it programmatically
  return outboundQueue;
}

// A simple ID generator (you can replace with crypto.randomUUID() if preferred)
const generateId = () => Math.random().toString(36).substring(2, 15);

export function setupRPCStream<T>(
  stream: Stream,
  handleIncomingRequest: (message: BaseMessage<T>) => BaseMessage<T> | null | Promise<BaseMessage<T> | null>,
  requestTimeoutMs: number = 10000,
) {
  const outboundQueue = pushable<Uint8Array>();

  const pendingRequests = new Map<
    string,
    { resolve: (val: BaseMessage<T> | PromiseLike<BaseMessage<T>>) => void; reject: (err: unknown) => void }
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
              pendingRequests.get(message.responseCorrelationId)!.resolve(message);
              pendingRequests.delete(message.responseCorrelationId); // Cleanup
            }
            // It's a new REQUEST from the other side
            else {
              const response = await handleIncomingRequest(message);
              if (response) {
                // Auto-link our response to their original request ID
                response.responseCorrelationId = message.id;
                outboundQueue.push(uint8ArrayFromString(JSON.stringify(response)));
              }
            }
          }
        },
      );
    } catch (err) {
      console.error('Error in read pipeline:', err);
    }
  });

  const sendRequest = (msg: Omit<BaseMessage<T>, 'id'>): Promise<BaseMessage<T>> => {
    const id = generateId();
    const fullMessage = { ...msg, id } as BaseMessage<T>;

    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });

      outboundQueue.push(uint8ArrayFromString(JSON.stringify(fullMessage)));

      // Adding a timeout here so promises don't hang forever if the peer drops
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.get(id)!.reject(new Error(`Request timeout for message: ${msg.responseCorrelationId}`));
          pendingRequests.delete(id);
        }
      }, requestTimeoutMs);
    });
  };

  return { sendRequest };
}
