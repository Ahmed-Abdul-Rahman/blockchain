/** biome-ignore-all lint/suspicious/noExplicitAny: <Need a generic DirectStreamPropagation Implementation not tied to any specific message type> */
import { IncomingStreamData, Libp2p, PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { DeChatComponents, DeChatFactory } from '../../types';
import { now, readMessagesFromStream, writeToStream } from '../../utils';
import { PropagatedMessage, PropagationContext } from '../types';
import { DirectPropagationInterface } from './DirectPropagationInterface';

export class DirectStreamPropagation implements DirectPropagationInterface {
  private readonly node: Libp2p;

  /** protocol handler functions that gets executed once message is received on a particular protocol*/
  private readonly protocolHandlers: Map<
    string,
    (message: PropagatedMessage<any>, ctx: PropagationContext) => Promise<void> | void
  >;

  private config: DeChatComponents['config']['strategies']['propagation']['direct'];

  /** Flag to stop the protocol handling */
  private stopped = false;

  constructor(components: DeChatComponents) {
    this.node = components.libp2p;
    this.config = components.config.strategies.propagation.direct;
    this.protocolHandlers = new Map();
  }

  start(): void | Promise<void> {}

  private async handleIncomingStream<T>({ stream, connection }: IncomingStreamData, protocol: string) {
    if (this.stopped) return;
    try {
      await readMessagesFromStream(
        stream,
        (message) => {
          const receivedMessage = message as PropagatedMessage<T>;
          const protocolHandler = this.protocolHandlers.get(protocol);
          if (protocolHandler) protocolHandler(receivedMessage, { from: connection.remotePeer, receivedAt: now() });
        },
        this.config.maxMessageBytes,
      );
    } finally {
      stream.close();
    }
  }

  async send<T>(peerId: PeerId | string, protocol: string, message: PropagatedMessage<T>): Promise<void> {
    if (this.stopped) {
      throw new Error('DirectStreamPropagation is stopped');
    }
    const receiverPeerId = typeof peerId === 'string' ? peerIdFromString(peerId) : peerId;
    const stream = await this.node.dialProtocol(receiverPeerId, protocol);
    await writeToStream(stream, message);
  }

  onReceive<T>(
    protocol: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => Promise<void> | void,
  ): void {
    this.node.handle(protocol, (data) => this.handleIncomingStream(data, protocol));
    this.protocolHandlers.set(protocol, handler);
  }

  async unhandleProtocol(protocol: string): Promise<void> {
    return await this.node.unhandle(protocol);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.node.unhandle(Array.from(this.protocolHandlers.keys()));
    this.protocolHandlers.clear();
  }
}

export const directStreamPropagation = (): DeChatFactory<DirectStreamPropagation> => {
  return (components) => new DirectStreamPropagation(components);
};
