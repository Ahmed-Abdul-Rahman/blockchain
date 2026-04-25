import { PeerId } from '@libp2p/interface';
import { PropagatedMessage, PropagationContext } from '../types';

export interface DirectPropagationInterface {
  /**
   * Send a message directly to a specific peer.
   */
  send<T>(peerId: PeerId | string, protocol: string, message: PropagatedMessage<T>): Promise<void>;

  /**
   * Register a handler for inbound direct messages.
   * Only one handler is expected per instance.
   */
  onReceive<T>(
    protocol: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => Promise<void> | void,
  ): void;

  /**
   * Unregister a handler for a given protocol
   */
  unhandleProtocol(protocol: string): Promise<void>;
  /**
   * Stop handling direct messages and release resources.
   * unhandle protocols, closes open streams if any, makes the instance inert
   */
  stop(): Promise<void>;
}
