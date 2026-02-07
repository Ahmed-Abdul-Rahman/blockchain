import { PeerId } from '@libp2p/interface';
import { PropagatedMessage, PropagationContext } from '../types';

export interface DirectPropagationInterface {
  /**
   * Send a message directly to a specific peer.
   */
  send<T>(peerId: PeerId | string, message: PropagatedMessage<T>): Promise<void>;

  /**
   * Register a handler for inbound direct messages.
   * Only one handler is expected per instance.
   */
  onReceive<T>(handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => void): void;

  /**
   * Stop handling direct messages and release resources.
   * unhandle protocols, closes open streams if any, makes the instance inert
   */
  stop(): Promise<void>;
}
