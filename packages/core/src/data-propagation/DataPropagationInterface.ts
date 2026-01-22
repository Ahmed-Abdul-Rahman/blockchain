import { PropagatedMessage, PropagationContext } from './types';

export interface DataPropagationInterface {
  /**
   * Publish data to the network
   */
  publish<T>(topic: string, message: PropagatedMessage<T>): Promise<void> | void;

  /**
   * Subscribe to incoming data
   */
  subscribe<T>(
    topic: string,
    handler: (message: PropagatedMessage<T>, ctx: PropagationContext) => Promise<void> | void,
  ): Promise<void> | void;

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string): Promise<void> | void;

  /**
   * clear all the messages in a given topic or if topic not provided clears all messages of all topics.
   */
  clearMessages(topic?: string): void;

  /**
   * Shutdown / cleanup
   */
  stop(): Promise<void> | void;
}
