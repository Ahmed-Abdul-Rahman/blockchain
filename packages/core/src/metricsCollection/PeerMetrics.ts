export class PeerMetrics {
  private authAttempts = new Map<string, number>();
  private authSuccesses = new Map<string, number>();

  recordAuthAttempt(peerId: string): void {
    this.authAttempts.set(peerId, (this.authAttempts.get(peerId) || 0) + 1);
  }

  getSuccessRate(peerId: string): number {
    const attempts = this.authAttempts.get(peerId) || 0;
    const successes = this.authSuccesses.get(peerId) || 0;
    return attempts > 0 ? successes / attempts : 0;
  }
}
