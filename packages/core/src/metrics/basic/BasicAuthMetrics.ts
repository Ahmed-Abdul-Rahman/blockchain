import { AuthMetrics } from '../interfaces/AuthMetrics';
import { BaseMetrics } from './BaseMetrics';

export class BasicAuthMetrics extends BaseMetrics implements AuthMetrics {
  readonly namespace = 'auth';

  verificationSucceeded(): void {
    this.inc('verification_succeeded');
  }

  verificationFailed(reason: string): void {
    this.inc('verification_failed');
    this.inc(`verification_failed_reason:${reason}`);
  }
}
