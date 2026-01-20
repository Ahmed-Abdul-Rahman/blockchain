import { logger } from '@dechat/common';
import { Libp2p } from '@libp2p/interface';

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

export interface NodeMetrics {
  connections: {
    total: number;
    inbound: number;
    outbound: number;
    unique: number;
  };
  peers: {
    discovered: number;
    authenticated: number;
    dialable: number;
    registry_size: number;
  };
  dialQueue: {
    size: number;
    target_connections: number;
  };
  performance: {
    uptime_ms: number;
    memory_mb: number;
    cpu_percent: number;
  };
  pubsub?: {
    topics: number;
    messages_sent: number;
    messages_received: number;
  };
  peerExchange: {
    requests_sent: number;
    requests_received: number;
    peers_shared: number;
  };
}

export class MetricsCollector {
  private metrics: Map<string, Metric[]> = new Map();
  private collectionInterval: NodeJS.Timeout | null = null;
  private node: Libp2p | null = null;
  private startTime: number = Date.now();

  // Counters
  private counters = {
    peersDiscovered: 0,
    peersAuthenticated: 0,
    dialAttempts: 0,
    dialFailures: 0,
    dialSuccesses: 0,
    pexRequestsSent: 0,
    pexRequestsReceived: 0,
    pexPeersShared: 0,
    pubsubMessagesSent: 0,
    pubsubMessagesReceived: 0,
  };

  constructor(node?: Libp2p) {
    this.node = node || null;
  }

  setNode(node: Libp2p): void {
    this.node = node;
  }

  // Counter increments
  incrementPeerDiscovered(): void {
    this.counters.peersDiscovered++;
  }

  incrementPeerAuthenticated(): void {
    this.counters.peersAuthenticated++;
  }

  incrementDialAttempt(): void {
    this.counters.dialAttempts++;
  }

  incrementDialFailure(): void {
    this.counters.dialFailures++;
  }

  incrementDialSuccess(): void {
    this.counters.dialSuccesses++;
  }

  incrementPexRequest(sent: boolean): void {
    if (sent) this.counters.pexRequestsSent++;
    else this.counters.pexRequestsReceived++;
  }

  incrementPexPeersShared(count: number): void {
    this.counters.pexPeersShared += count;
  }

  incrementPubsubMessage(sent: boolean): void {
    if (sent) this.counters.pubsubMessagesSent++;
    else this.counters.pubsubMessagesReceived++;
  }

  private recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    const metric: Metric = {
      name,
      value,
      timestamp: Date.now(),
      labels,
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const history = this.metrics.get(name)!;
    history.push(metric);

    // Keep only last 1000 samples per metric
    if (history.length > 1000) {
      history.shift();
    }
  }

  collectSnapshot(additionalContext?: {
    registrySize?: number;
    dialQueueSize?: number;
    targetConnections?: number;
  }): NodeMetrics {
    if (!this.node) {
      throw new Error('Node not set in MetricsCollector');
    }

    const connections = this.node.getConnections();
    const uniquePeers = new Set(connections.map((c) => c.remotePeer.toString()));

    const metrics: NodeMetrics = {
      connections: {
        total: connections.length,
        inbound: connections.filter((c) => c.direction === 'inbound').length,
        outbound: connections.filter((c) => c.direction === 'outbound').length,
        unique: uniquePeers.size,
      },
      peers: {
        discovered: this.counters.peersDiscovered,
        authenticated: this.counters.peersAuthenticated,
        dialable: this.counters.dialSuccesses,
        registry_size: additionalContext?.registrySize || 0,
      },
      dialQueue: {
        size: additionalContext?.dialQueueSize || 0,
        target_connections: additionalContext?.targetConnections || 0,
      },
      performance: {
        uptime_ms: Date.now() - this.startTime,
        memory_mb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
        cpu_percent: 0, // Would need external lib for accurate CPU
      },
      peerExchange: {
        requests_sent: this.counters.pexRequestsSent,
        requests_received: this.counters.pexRequestsReceived,
        peers_shared: this.counters.pexPeersShared,
      },
    };

    // Record metrics
    this.recordMetric('connections.total', metrics.connections.total);
    this.recordMetric('connections.unique', metrics.connections.unique);
    this.recordMetric('peers.registry_size', metrics.peers.registry_size);
    this.recordMetric('performance.memory_mb', metrics.performance.memory_mb);

    return metrics;
  }

  startPeriodicCollection(intervalMs: number = 30_000): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }

    this.collectionInterval = setInterval(() => {
      try {
        const snapshot = this.collectSnapshot();
        logger.debug('Metrics snapshot:', snapshot);
      } catch (error) {
        logger.error('Failed to collect metrics:', error);
      }
    }, intervalMs);
  }

  stopPeriodicCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
  }

  getMetricHistory(name: string): Metric[] {
    return this.metrics.get(name) || [];
  }

  exportPrometheus(): string {
    const lines: string[] = [];

    for (const [name, history] of this.metrics) {
      if (history.length === 0) continue;

      const latest = history[history.length - 1];
      const metricName = name.replace(/\./g, '_');

      lines.push(`# TYPE ${metricName} gauge`);

      if (latest.labels) {
        const labelStr = Object.entries(latest.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${metricName}{${labelStr}} ${latest.value}`);
      } else {
        lines.push(`${metricName} ${latest.value}`);
      }
    }

    return lines.join('\n');
  }

  reset(): void {
    this.metrics.clear();
    Object.keys(this.counters).forEach((key) => {
      this.counters[key as keyof typeof this.counters] = 0;
    });
  }
}
