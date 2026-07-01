/** Default sliding window for replication activity events (5 minutes) */
const ACTIVITY_WINDOW_MS = 5 * 60_000;

/** Reference rate used to normalize events-per-minute into [0, 1] for the state vector */
const MSGS_PER_MIN_NORMALIZER = 60;

interface ActivityEvent {
  /** Epoch ms when the event occurred */
  readonly timestamp: number;
}

/**
 * Tracks local replication production events in a sliding time window.
 * Proxies chat activity until a room-scoped activity signal exists.
 */
export class ReplicationActivityTracker {
  private readonly events: ActivityEvent[] = [];

  /** Record a locally produced message (onLocalDataProduced) */
  recordLocalProduce(): void {
    this.events.push({ timestamp: Date.now() });
  }

  /** Record a remotely received message (optional gossip proxy) */
  recordRemoteReceive(): void {
    this.events.push({ timestamp: Date.now() });
  }

  /**
   * Events per minute within the sliding window, normalized to msgsPerMin / 60
   * for consumption by StateVectorBuilder (index 5).
   */
  getRatePerMinute(now: number): number {
    this.pruneOldEvents(now);
    if (this.events.length === 0) {
      return 0;
    }
    const windowMinutes = ACTIVITY_WINDOW_MS / 60_000;
    const eventsPerMinute = this.events.length / windowMinutes;
    return eventsPerMinute / MSGS_PER_MIN_NORMALIZER;
  }

  /** Number of events currently in the window (for tests) */
  getEventCount(now: number): number {
    this.pruneOldEvents(now);
    return this.events.length;
  }

  private pruneOldEvents(now: number): void {
    const cutoff = now - ACTIVITY_WINDOW_MS;
    while (this.events.length > 0 && this.events[0].timestamp < cutoff) {
      this.events.shift();
    }
  }
}
