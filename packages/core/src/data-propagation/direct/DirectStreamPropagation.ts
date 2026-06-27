/** biome-ignore-all lint/suspicious/noExplicitAny: <Need a generic DirectStreamPropagation Implementation not tied to any specific message type> */

import { logger } from '@dechat/common';
import { IncomingStreamData, Libp2p, PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { readMessagesFromStream, writeToStream } from '../../shared/streamUtils';
import { DeChatComponents, DeChatFactory } from '../../types';
import { MessageHandler, PropagatedMessage, PropagationContext } from '../types';
import { DirectPropagationInterface } from './DirectPropagationInterface';

export class DirectStreamPropagation implements DirectPropagationInterface {
  private readonly node: Libp2p;

  /** protocol handler functions that gets executed once message is received on a particular protocol*/
  private readonly protocolHandlers: Map<string, Set<MessageHandler<any>>>;

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
          const protocolHandlers = this.protocolHandlers.get(protocol);
          if (!protocolHandlers) return;
          for (const handler of protocolHandlers) {
            if (handler) {
              Promise.resolve(handler(receivedMessage, { from: connection.remotePeer, receivedAt: Date.now() })).catch(
                (err) => logger.error(`[DirectStreamPropagtion] Handler error on protocol ${protocol}: ${err.message}`),
              );
            }
          }
        },
        this.config.maxMessageBytes,
      );
    } finally {
      stream.close();
    }
  }

  async send<T>(peerId: PeerId | string, protocol: string, message: PropagatedMessage<T>): Promise<void> {
    if (this.stopped) {
      throw new Error('[DirectStreamPropagation] is stopped');
    }
    const receiverPeerId = typeof peerId === 'string' ? peerIdFromString(peerId) : peerId;
    const stream = await this.node.dialProtocol(receiverPeerId, protocol);
    await writeToStream(stream, message);
  }

  onReceive<T>(
    protocol: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => Promise<void> | void,
  ): void {
    if (!this.protocolHandlers.has(protocol)) {
      this.protocolHandlers.set(protocol, new Set());
      this.node.handle(protocol, (data) => this.handleIncomingStream(data, protocol));
      logger.debug(`[DirectStreamPropagation] Network joined protocol: ${protocol}`);
    }
    this.protocolHandlers.get(protocol)!.add(handler);
  }

  async removeHandler<T>(protocol: string, handler: MessageHandler<T>): Promise<void> {
    const handlers = this.protocolHandlers.get(protocol);
    if (handlers) {
      handlers.delete(handler);
      logger.debug(`[DirectStreamPropagation] Local handler detached from topic: ${protocol}`);
      if (handlers.size === 0) {
        this.protocolHandlers.delete(protocol);
        await this.node.unhandle(protocol);
        logger.debug(`[DirectStreamPropagation] Network left topic: ${protocol} (No more local listeners)`);
      }
    }
  }

  async unhandleProtocol(protocol: string): Promise<void> {
    this.protocolHandlers.get(protocol)?.clear();
    this.protocolHandlers.delete(protocol);
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
