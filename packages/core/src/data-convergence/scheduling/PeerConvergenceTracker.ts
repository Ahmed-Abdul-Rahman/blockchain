import { DeChatConfig } from '../../config/types';

type PeerConvergenceConfig = DeChatConfig['strategies']['synchronizer']['adaptive']['peerConvergence'];

interface PeerEntry {
  /** Current EMA convergence score for this peer */
  score: number;

  /** Epoch ms of the last sync interaction with this peer */
  lastInteractionAt: number;
}

/**
 * Per-peer EMA convergence scores measuring sync utility only.
 * Intentionally separate from SimplePeerScorer (PEX/dial trust).
 */
export class PeerConvergenceTracker {
  private readonly entries = new Map<string, PeerEntry>();

  /**
   * @param config EMA smoothing parameters from synchronizer.adaptive.peerConvergence
   */
  constructor(private readonly config: PeerConvergenceConfig) {}

  /** Current convergence score for a peer; returns neutralScore when unknown */
  getScore(peerId: string): number {
    return this.entries.get(peerId)?.score ?? this.config.neutralScore;
  }

  /** Boost score after a useful sync (hashes discovered > 0) */
  onUsefulSync(peerId: string, hashesDiscovered: number): void {
    const entry = this.getOrCreate(peerId);
    const boost = this.config.alpha * Math.min(1, hashesDiscovered / 10);
    entry.score = Math.min(1, entry.score + boost);
    entry.lastInteractionAt = Date.now();
  }

  /** Decay score after a converged but useless sync (complete, zero hashes) */
  onUselessSync(peerId: string): void {
    const entry = this.getOrCreate(peerId);
    entry.score = Math.max(0, entry.score - this.config.beta);
    entry.lastInteractionAt = Date.now();
  }

  /** Decay score after a failed or partial sync */
  onFailedSync(peerId: string): void {
    const entry = this.getOrCreate(peerId);
    entry.score = Math.max(0, entry.score - this.config.gamma);
    entry.lastInteractionAt = Date.now();
  }

  /**
   * Decay idle peer scores toward neutralScore after idleDecayMs without interaction.
   * Called periodically from the metrics store on outbound sync completion.
   */
  decayIdlePeers(now: number): void {
    for (const entry of this.entries.values()) {
      if (now - entry.lastInteractionAt >= this.config.idleDecayMs) {
        // Move one step toward neutral on each decay pass
        const delta = this.config.neutralScore - entry.score;
        entry.score += delta * 0.1;
      }
    }
  }

  /** Read-only snapshot of all peer scores (for tests and debug) */
  snapshot(): ReadonlyMap<string, number> {
    return new Map([...this.entries.entries()].map(([id, e]) => [id, e.score]));
  }

  private getOrCreate(peerId: string): PeerEntry {
    let entry = this.entries.get(peerId);
    if (!entry) {
      entry = { score: this.config.neutralScore, lastInteractionAt: Date.now() };
      this.entries.set(peerId, entry);
    }
    return entry;
  }
}
