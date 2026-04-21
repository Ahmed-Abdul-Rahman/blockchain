/** biome-ignore-all lint/suspicious/noExplicitAny: <Need a generic DirectStreamPropagation Implementation not tied to any specific message type> */
import { IncomingStreamData, Libp2p, PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { now, readMessagesFromStream, writeToStream } from '../../utils';
import { PropagatedMessage, PropagationContext } from '../types';
import { DirectPropagationInterface } from './DirectPropagationInterface';

export class DirectStreamPropagation implements DirectPropagationInterface {
  private readonly node: Libp2p;

  /** Handler function that gets executed once message is received */
  private protocolHandlers: Map<
    string,
    (message: PropagatedMessage<any>, ctx: PropagationContext) => Promise<void> | void
  >;

  /** Maximum message length that can be read */
  private readonly maxMessageBytes: number;

  /** Flag to stop the protocol handling */
  private stopped = false;

  constructor(node: Libp2p, maxMessageBytes: number = 256 * 1024) {
    this.node = node;
    this.maxMessageBytes = maxMessageBytes;
    this.protocolHandlers = new Map();
  }

  async send<T>(peerId: PeerId | string, protocol: string, message: PropagatedMessage<T>): Promise<void> {
    if (this.stopped) {
      throw new Error('DirectStreamPropagation is stopped');
    }
    const receiverPeerId = typeof peerId === 'string' ? peerIdFromString(peerId) : peerId;
    const stream = await this.node.dialProtocol(receiverPeerId, protocol);
    await writeToStream(stream, message);
  }

  onReceive<T>(protocol: string, handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => void): void {
    this.protocolHandlers.set(protocol, handler);
    this.node.handle(protocol, async ({ stream, connection }: IncomingStreamData) => {
      if (this.stopped) return;
      try {
        await readMessagesFromStream(
          stream,
          (message) => {
            const receivedMessage = message as PropagatedMessage<T>;
            handler(receivedMessage, { from: connection.remotePeer, receivedAt: now() });
          },
          this.maxMessageBytes,
        );
      } finally {
        stream.close();
      }
    });
  }

  unregisterProtocol(protocol: string): void {
    this.protocolHandlers.delete(protocol);
    this.node.unhandle(protocol);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.all(Array.from(this.protocolHandlers.keys()).map((protocol) => this.node.unhandle(protocol))).catch(
      (err) => console.error('Error stopping DirectStreamPropagation:', err),
    );
    this.protocolHandlers.clear();
  }
}
