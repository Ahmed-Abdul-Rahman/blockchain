import { logger } from '@dechat/common';
import { Libp2p } from '@libp2p/interface';
import EventEmitter from 'events';

export enum NodeState {
  INITIALIZING = 'initializing',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
}

export interface LifecycleEvent {
  state: NodeState;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LifecycleHooks {
  onInitializing?: () => Promise<void>;
  onStarting?: () => Promise<void>;
  onRunning?: () => Promise<void>;
  onStopping?: () => Promise<void>;
  onStopped?: () => Promise<void>;
  onError?: (error?: Error) => Promise<void>;
}

export class LifecycleManager extends EventEmitter {
  private currentState: NodeState = NodeState.STOPPED;
  private stateHistory: LifecycleEvent[] = [];
  private hooks: LifecycleHooks = {};
  private node: Libp2p | null = null;
  private cleanupTasks: Array<() => Promise<void>> = [];

  constructor(hooks?: LifecycleHooks) {
    super();
    this.hooks = hooks || {};
  }

  setNode(node: Libp2p): void {
    this.node = node;
  }

  getCurrentState(): NodeState {
    return this.currentState;
  }

  getStateHistory(): LifecycleEvent[] {
    return [...this.stateHistory];
  }

  registerCleanupTask(task: () => Promise<void>): void {
    this.cleanupTasks.push(task);
  }

  private async transitionTo(newState: NodeState, metadata?: Record<string, unknown>): Promise<void> {
    const oldState = this.currentState;

    logger.info(`Lifecycle transition: ${oldState} → ${newState}`, metadata);

    this.currentState = newState;

    const event: LifecycleEvent = {
      state: newState,
      timestamp: Date.now(),
      metadata,
    };

    this.stateHistory.push(event);
    this.emit('stateChange', event);

    // Execute hook if available
    const hookName = `on${newState.charAt(0).toUpperCase()}${newState.slice(1)}` as keyof LifecycleHooks;
    const hook = this.hooks[hookName];

    if (hook) {
      try {
        await hook();
      } catch (error) {
        logger.error(`Hook ${hookName} failed:`, error);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.currentState !== NodeState.STOPPED) {
      throw new Error(`Cannot initialize from state ${this.currentState}`);
    }

    await this.transitionTo(NodeState.INITIALIZING);
  }

  async start(): Promise<void> {
    if (this.currentState !== NodeState.INITIALIZING) {
      throw new Error(`Cannot start from state ${this.currentState}`);
    }

    await this.transitionTo(NodeState.STARTING);

    if (!this.node) {
      throw new Error('Node not set in LifecycleManager');
    }

    await this.node.start();
    await this.transitionTo(NodeState.RUNNING);
  }

  async stop(): Promise<void> {
    if (this.currentState !== NodeState.RUNNING) {
      logger.warn(`Stopping from unexpected state: ${this.currentState}`);
    }

    await this.transitionTo(NodeState.STOPPING);

    // Execute cleanup tasks in reverse order
    for (const task of this.cleanupTasks.reverse()) {
      try {
        await task();
      } catch (error) {
        logger.error('Cleanup task failed:', error);
      }
    }

    if (this.node) {
      await this.node.stop();
    }

    await this.transitionTo(NodeState.STOPPED);
  }

  async handleError(error: Error): Promise<void> {
    await this.transitionTo(NodeState.ERROR, { error: error.message });

    if (this.hooks.onError) {
      await this.hooks.onError(error);
    }
  }

  isHealthy(): boolean {
    return this.currentState === NodeState.RUNNING;
  }

  getUptime(): number {
    const runningEvent = this.stateHistory.find((e) => e.state === NodeState.RUNNING);
    return runningEvent ? Date.now() - runningEvent.timestamp : 0;
  }
}
