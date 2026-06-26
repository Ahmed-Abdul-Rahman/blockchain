import { PeerId, Startable } from '@libp2p/interface';
import { MessageHandler, PropagatedMessage, PropagationContext } from '../types';

export interface DirectPropagationInterface extends Startable {
  /**
   * Send a message directly to a specific peer.
   */
  send<T>(peerId: PeerId | string, protocol: string, message: PropagatedMessage<T>): Promise<void>;

  /**
   * Register a handler for inbound direct messages.
   * Only one handler is expected per instance.
   */
  onReceive<T>(protocol: string, handler: MessageHandler<T>): void;

  /**
   * Unregister a handler for a given protocol
   */
  removeHandler<T>(protocol: string, handler: MessageHandler<T>): Promise<void>;

  /**
   * Unhandle a given protocol completely
   */
  unhandleProtocol(protocol: string): Promise<void>;
}
