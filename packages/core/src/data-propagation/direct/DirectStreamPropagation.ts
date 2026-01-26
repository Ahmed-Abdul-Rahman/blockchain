import { IncomingStreamData, Libp2p, PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { now, readMessagesFromStream, writeToStream } from '../../utils';
import { PropagatedMessage, PropagationContext } from '../types';
import { DirectPropagationInterface } from './DirectPropagationInterface';

export class DirectStreamPropagation<T> implements DirectPropagationInterface<T> {
  private readonly node: Libp2p;

  /** Procotol used for Streaming */
  private readonly protocol: string;

  /** Handler function that gets executed once message is received */
  private handler?: (message: PropagatedMessage<T>, ctx: PropagationContext) => void;

  /** Maximum message length that can be read */
  private readonly maxMessageBytes: number;

  /** Flag to stop the protocol handling */
  private stopped = false;

  constructor(node: Libp2p, protocol: string, maxMessageBytes: number = 256 * 1024) {
    this.node = node;
    this.protocol = protocol;
    this.maxMessageBytes = maxMessageBytes;

    this.node.handle(protocol, this.handleIncomingStream.bind(this));
  }

  private async handleIncomingStream({ stream, connection }: IncomingStreamData) {
    if (this.stopped) return;
    try {
      await readMessagesFromStream(
        stream,
        (message) => {
          const receivedMessage = message as PropagatedMessage<T>;
          if (this.handler) this.handler(receivedMessage, { from: connection.remotePeer, receivedAt: now() });
        },
        this.maxMessageBytes,
      );
    } finally {
      stream.close();
    }
  }

  async send(peerId: PeerId | string, message: PropagatedMessage<T>): Promise<void> {
    if (this.stopped) {
      throw new Error('DirectStreamPropagation is stopped');
    }
    const receiverPeerId = typeof peerId === 'string' ? peerIdFromString(peerId) : peerId;
    const stream = await this.node.dialProtocol(receiverPeerId, this.protocol);
    await writeToStream(stream, message);
  }

  onReceive(handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => void): void {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.handler = undefined;
    this.node.unhandle(this.protocol);
  }
}
