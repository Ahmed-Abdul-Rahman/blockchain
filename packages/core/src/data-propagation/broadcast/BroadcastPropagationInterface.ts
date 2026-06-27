import { Startable } from '@libp2p/interface';
import { MessageHandler, PropagatedMessage, PropagationContext } from '../types';

export interface BroadcastPropagationInterface extends Startable {
  /**
   * Publish data to the network
   */
  publish<T>(topic: string, message: PropagatedMessage<T>): Promise<void> | void;

  /**
   * Subscribe to incoming data
   */
  subscribe<T>(topic: string, handler: MessageHandler<T>): Promise<void> | void;

  /**
   * Unsubscribe from a topic
   */
  unsubscribe<T>(topic: string, handler: MessageHandler<T>, purgeData?: boolean): Promise<void> | void;

  /**
   * clear all the messages in a given topic or if topic not provided clears all messages of all topics.
   */
  clearMessages?(topic?: string): void;
}
