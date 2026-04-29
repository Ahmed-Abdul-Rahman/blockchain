import { DeChatComponents, DeChatFactory } from '../types';

export class SimplePeerScorer {
  private scores: Map<string, number>;

  private config: DeChatComponents['config']['scoring'];

  /** Used to periodically apply score decay for the peer based on last seen*/
  private lastSeen: Map<string, number>;

  constructor(components: DeChatComponents) {
    this.config = components.config.scoring;

    this.scores = new Map<string, number>();
    this.lastSeen = new Map<string, number>();
  }

  /**
   * increase the score of a peer by given {amount}
   * @param peerId
   * @param amount
   */
  reward(peerId: string, amount = 1): void {
    const s = Math.min(this.config.maxScore, (this.scores.get(peerId) ?? 0) + amount);
    this.scores.set(peerId, s);
    this.lastSeen.set(peerId, Date.now());
  }

  /**
   * reduce the score of a peer by given {amount}
   * @param peerId
   * @param amount
   */
  penalize(peerId: string, amount = 1): void {
    const s = Math.max(this.config.minScore, (this.scores.get(peerId) ?? 0) - amount);
    this.scores.set(peerId, s);
    this.lastSeen.set(peerId, Date.now());
  }

  /**
   *
   * @param peerId
   * @returns {number} score of the peerId
   */
  get(peerId: string): number {
    return this.scores.get(peerId) ?? 0;
  }

  /**
   *  returns the top K peers whose score is the best in registry
   * @returns {string[]}
   */
  getBestScorePeers(K: number): string[] {
    const entries = [...this.scores.entries()].filter(([, score]) => score >= this.config.minDialableScore);
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, K).map(([peerId]) => peerId);
  }

  /**
   * soft policy: only connect to peers with score >= -2
   * @param peerId
   * @returns true if score greater than -2 otherwise false
   */
  isDialable(peerId: string): boolean {
    return this.get(peerId) >= this.config.minDialableScore;
  }

  //

  /**
   * harder policy for accepting inbound (optional)
   * @param peerId
   * @returns
   */
  isAcceptingInbound(peerId: string): boolean {
    return this.get(peerId) >= -5;
  }

  /**
   *  decays the score of every peer periodically by a factor of @property {config.decayFactor}
   */
  decay(): void {
    const now = Date.now();
    for (const [peerId, score] of this.scores) {
      const lastActivity = this.lastSeen.get(peerId) || 0;
      const inactiveMs = now - lastActivity;

      // Decay faster for inactive peers
      if (inactiveMs > 5 * 60_000) {
        // 5 min
        this.scores.set(peerId, score * 0.5); // Faster decay
      } else {
        this.scores.set(peerId, score * this.config.decayFactor);
      }
    }
  }
}

export const simplePeerScorer = (): DeChatFactory<SimplePeerScorer> => {
  return (components) => new SimplePeerScorer(components);
};
