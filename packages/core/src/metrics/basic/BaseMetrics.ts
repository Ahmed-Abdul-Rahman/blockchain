export abstract class BaseMetrics {
  protected counters = new Map<string, number>();
  protected gauges = new Map<string, number>();

  protected inc(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  protected setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
  } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
