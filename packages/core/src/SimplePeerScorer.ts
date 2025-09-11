export class SimplePeerScorer {
  private scores: Map<string, number>;
  private lastSeen: Map<string, number>;
  private readonly MIN_SCORE: number;
  private readonly MAX_SCORE: number;
  private readonly MIN_DIALBALE_SCORE: number;
  private readonly DECAY: number; // apply periodically

  constructor(minScore: number = -10, maxScore: number = 100, minDiableScore: number = -2, decay: number = 0.98) {
    this.MIN_SCORE = minScore;
    this.MAX_SCORE = maxScore;
    this.DECAY = decay;
    this.MIN_DIALBALE_SCORE = minDiableScore;
    this.scores = new Map<string, number>();
    this.lastSeen = new Map<string, number>();
  }

  /**
   * increase the score of a peer by given {amount}
   * @param peerId
   * @param amount
   */
  reward(peerId: string, amount = 1): void {
    const s = Math.min(this.MAX_SCORE, (this.scores.get(peerId) ?? 0) + amount);
    this.scores.set(peerId, s);
    this.lastSeen.set(peerId, Date.now());
  }

  /**
   * reduce the score of a peer by given {amount}
   * @param peerId
   * @param amount
   */
  penalize(peerId: string, amount = 1): void {
    const s = Math.max(this.MIN_SCORE, (this.scores.get(peerId) ?? 0) - amount);
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
   * soft policy: only connect to peers with score >= -2
   * @param peerId
   * @returns true if score greater than -2 otherwise false
   */
  isDialable(peerId: string): boolean {
    return this.get(peerId) >= this.MIN_DIALBALE_SCORE;
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
   *  decays the score of every peer periodically by a factor of @constant {DECAY}
   */
  decay(): void {
    for (const [peerId, score] of this.scores) {
      this.scores.set(peerId, score * this.DECAY);
    }
  }
}
