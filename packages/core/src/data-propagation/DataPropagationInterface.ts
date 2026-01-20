import { PropagationContext } from './types';

export interface DataPropagationInterface<T> {
  /**
   * Publish data to the network
   */
  publish(topic: string, message: T): Promise<void>;

  /**
   * Subscribe to incoming data
   */
  subscribe(topic: string, handler: (message: T, ctx: PropagationContext) => Promise<void> | void): Promise<void>;

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string): Promise<void>;

  /**
   * Shutdown / cleanup
   */
  stop(): Promise<void>;
}
