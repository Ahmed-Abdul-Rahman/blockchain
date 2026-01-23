import { DialQueueMetrics } from '../interfaces/DialQueueMetrics';

export class NoopDialQueueMetrics implements DialQueueMetrics {
  readonly namespace = 'dialqueue';

  dialAttempt(): void {}
  dialSucceeded(): void {}
  dialFailed(reason: 'timeout' | 'refused' | 'error'): void {}
  peerEnqueued(peerId: string): void {}
  connectionAdded(): void {}
  connectionRemoved(): void {}
  targetConnectionsComputed(target: number): void {}
}
