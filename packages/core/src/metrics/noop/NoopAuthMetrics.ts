import { AuthMetrics } from '../interfaces/AuthMetrics';

export class NoopAuthMetrics implements AuthMetrics {
  readonly namespace = 'auth';

  verificationSucceeded(): void {}
  verificationFailed(reason: 'invalid_signature' | 'unknown_peer' | 'peer_id_mismatch' | 'invalid_public_key'): void {}
}
