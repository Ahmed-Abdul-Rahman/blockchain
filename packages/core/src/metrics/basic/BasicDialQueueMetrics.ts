import { DialQueueMetrics } from '../interfaces/DialQueueMetrics';
import { BaseMetrics } from './BaseMetrics';

export class BasicDialQueueMetrics extends BaseMetrics implements DialQueueMetrics {
  readonly namespace = 'dialqueue';

  peerEnqueued(peerId: string): void {
    this.inc('enqueued_peers');
  }

  dialAttempt(): void {
    this.inc('dial_attempt');
  }

  dialSucceeded(): void {
    this.inc('dial_succeeded');
  }

  dialFailed(reason: string): void {
    this.inc('dial_failed');
    this.inc(`dial_failed_reason:${reason}`);
  }

  connectionAdded(): void {
    this.inc('connection_added');
  }

  connectionRemoved(): void {
    this.inc('connection_removed');
  }

  targetConnectionsComputed(target: number): void {
    this.setGauge('target_connections', target);
  }
}
