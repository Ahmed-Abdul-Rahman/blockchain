export interface AuthMetrics {
  readonly namespace: 'auth';

  verificationSucceeded(): void;

  verificationFailed(reason: 'invalid_signature' | 'unknown_peer'): void;
}
