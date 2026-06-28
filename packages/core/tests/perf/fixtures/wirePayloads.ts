import type { PropagatedMessage } from '../../../src/data-propagation/types';
import type { ReplicationContent } from '../../../src/data-replication/replication-protocol/ReplicationProtocolInterface';

const repeatChar = (char: string, count: number): string => char.repeat(count);

export interface WirePayloadFixture {
  readonly id: string;
  readonly description: string;
  readonly value: unknown;
  readonly serializeIterations: number;
  readonly deserializeIterations: number;
  readonly eventLoopIterations: number;
}

export const createPropagatedMessageSmall = (): PropagatedMessage<{ text: string }> => ({
  id: 'msg-small-1',
  from: '12D3KooWMaZqaq2PnMd2KX6Qfansf3EBto95PYL8Gh8q8YESRvS6',
  timestamp: Date.now(),
  payload: { text: repeatChar('a', 1024) },
  signature: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
});

export const createPropagatedMessageMedium = (): PropagatedMessage<{ text: string; tags: string[] }> => ({
  id: 'msg-medium-1',
  from: '12D3KooWSxkSckemwn7LP9EtGcCDNWZUjMh9bXpsxwaGaxKSEh3T',
  timestamp: Date.now(),
  payload: {
    text: repeatChar('b', 8 * 1024),
    tags: Array.from({ length: 32 }, (_, index) => `tag-${index}`),
  },
  signature: new Uint8Array(64).map((_, index) => index),
});

export const createReplicationContent = (byteLength: number): ReplicationContent => ({
  type: 'replication_content',
  hash: repeatChar('a', 64),
  replicationContent: new Uint8Array(byteLength).map((_, index) => index % 256),
});

/** Payloads shaped like DeChat wire messages across small/medium/large sizes. */
export const WIRE_PAYLOAD_FIXTURES: readonly WirePayloadFixture[] = [
  {
    id: 'propagated-message-1kb',
    description: 'GossipSub PropagatedMessage with ~1KB text payload and signature',
    value: createPropagatedMessageSmall(),
    serializeIterations: 10_000,
    deserializeIterations: 10_000,
    eventLoopIterations: 2_000,
  },
  {
    id: 'propagated-message-8kb',
    description: 'PropagatedMessage with ~8KB text and metadata',
    value: createPropagatedMessageMedium(),
    serializeIterations: 5_000,
    deserializeIterations: 5_000,
    eventLoopIterations: 1_000,
  },
  {
    id: 'replication-content-64kb',
    description: 'ReplicationContent with 64KB Uint8Array blob',
    value: createReplicationContent(64 * 1024),
    serializeIterations: 2_000,
    deserializeIterations: 2_000,
    eventLoopIterations: 500,
  },
  {
    id: 'replication-content-256kb',
    description: 'ReplicationContent with 256KB Uint8Array blob (storm-sized frame)',
    value: createReplicationContent(256 * 1024),
    serializeIterations: 500,
    deserializeIterations: 500,
    eventLoopIterations: 200,
  },
] as const;
