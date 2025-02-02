import { generateTimestamp } from '@common/utils';
import { Stream } from '@libp2p/interface';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { HandshakeProtocol } from './HandshakeProtocol';
import { INFO_HASH_EXG, NTWK_DATA_EXG } from './messageTypes';
import { NetworkNode } from './NetworkNode';
import { Ping } from './types';

export const writeToStream = async (stream: Stream | null, message: string): Promise<void> => {
  if (!stream) {
    console.log('Cannot write to stream as it is null');
    return;
  }
  await pipe(
    [message],
    (source) => map(source, (string) => uint8ArrayFromString(string)),
    (source) => lp.encode(source), // Encode with length prefix (so receiving side knows how much data is coming)
    stream,
  );
};

export const readFromStream = async (stream: Stream | null): Promise<Partial<object>[]> => {
  if (!stream) {
    console.log('Cannot read from stream as it is null');
    return [];
  }
  return await pipe(
    stream,
    (source) => lp.decode(source),
    (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
    async (source) => {
      const messages: Array<Partial<object>> = [];
      for await (const message of source) messages.push(JSON.parse(message));
      return messages;
    },
  );
};

export function getInfoHashMesg(this: HandshakeProtocol): object {
  return {
    infoHash: this.infoHash,
    nodeEventId: this.nodeEventId,
    nodeId: this.nodeId,
    stage: INFO_HASH_EXG,
    timestamp: generateTimestamp(),
  };
}

export function getNetworkExgMesg(this: HandshakeProtocol): object {
  return {
    connectedNodesCount: this.nodeStore.getSize(),
    nodeAddress: this.nodeAddress,
    port: process.env.SERVER_PORT,
    nodeId: this.nodeId,
    stage: NTWK_DATA_EXG,
    timestamp: generateTimestamp(),
  };
}

export function getPingMesg(this: NetworkNode, type: string = 'PING', status: string = 'NA'): Ping {
  return {
    type,
    status,
    fromNode: this.nodeId?.toString() as string,
    timestamp: Date.now(),
  };
}
