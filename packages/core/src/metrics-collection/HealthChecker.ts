import { logger } from '@dechat/common';
import { Libp2p } from '@libp2p/interface';
import { MetricsCollector, NodeMetrics } from './MetricsCollector';

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

export interface HealthCheck {
  status: HealthStatus;
  timestamp: number;
  checks: {
    connections: { status: HealthStatus; value: number; threshold: number };
    peers: { status: HealthStatus; value: number; threshold: number };
    memory: { status: HealthStatus; value: number; threshold: number };
  };
  overallMessage: string;
}

export class HealthChecker {
  private node: Libp2p;
  private metrics: MetricsCollector;
  private thresholds = {
    minConnections: 3,
    minPeers: 5,
    maxMemoryMb: 500,
  };

  constructor(node: Libp2p, metrics: MetricsCollector) {
    this.node = node;
    this.metrics = metrics;
  }

  setThresholds(thresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  check(): HealthCheck {
    const snapshot = this.metrics.collectSnapshot();

    const connectionStatus = this.checkConnections(snapshot);
    const peerStatus = this.checkPeers(snapshot);
    const memoryStatus = this.checkMemory(snapshot);

    const statuses = [connectionStatus.status, peerStatus.status, memoryStatus.status];
    const overallStatus = this.determineOverallStatus(statuses);

    const healthCheck: HealthCheck = {
      status: overallStatus,
      timestamp: Date.now(),
      checks: {
        connections: connectionStatus,
        peers: peerStatus,
        memory: memoryStatus,
      },
      overallMessage: this.generateMessage(overallStatus, snapshot),
    };

    logger.debug('Health check:', healthCheck);
    return healthCheck;
  }

  private checkConnections(snapshot: NodeMetrics): {
    status: HealthStatus;
    value: number;
    threshold: number;
  } {
    const value = snapshot.connections.unique;
    const threshold = this.thresholds.minConnections;

    let status: HealthStatus;
    if (value >= threshold) {
      status = HealthStatus.HEALTHY;
    } else if (value >= threshold / 2) {
      status = HealthStatus.DEGRADED;
    } else {
      status = HealthStatus.UNHEALTHY;
    }

    return { status, value, threshold };
  }

  private checkPeers(snapshot: NodeMetrics): {
    status: HealthStatus;
    value: number;
    threshold: number;
  } {
    const value = snapshot.peers.registry_size;
    const threshold = this.thresholds.minPeers;

    let status: HealthStatus;
    if (value >= threshold) {
      status = HealthStatus.HEALTHY;
    } else if (value >= threshold / 2) {
      status = HealthStatus.DEGRADED;
    } else {
      status = HealthStatus.UNHEALTHY;
    }

    return { status, value, threshold };
  }

  private checkMemory(snapshot: NodeMetrics): {
    status: HealthStatus;
    value: number;
    threshold: number;
  } {
    const value = snapshot.performance.memory_mb;
    const threshold = this.thresholds.maxMemoryMb;

    let status: HealthStatus;
    if (value <= threshold) {
      status = HealthStatus.HEALTHY;
    } else if (value <= threshold * 1.5) {
      status = HealthStatus.DEGRADED;
    } else {
      status = HealthStatus.UNHEALTHY;
    }

    return { status, value, threshold };
  }

  private determineOverallStatus(statuses: HealthStatus[]): HealthStatus {
    if (statuses.every((s) => s === HealthStatus.HEALTHY)) {
      return HealthStatus.HEALTHY;
    }
    if (statuses.some((s) => s === HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }
    return HealthStatus.DEGRADED;
  }

  private generateMessage(status: HealthStatus, snapshot: NodeMetrics): string {
    const messages: string[] = [];

    if (status === HealthStatus.HEALTHY) {
      messages.push(`Node healthy: ${snapshot.connections.unique} connections, ${snapshot.peers.registry_size} peers`);
    } else if (status === HealthStatus.DEGRADED) {
      messages.push('Node degraded:');
      if (snapshot.connections.unique < this.thresholds.minConnections) {
        messages.push(`  - Low connections: ${snapshot.connections.unique}`);
      }
      if (snapshot.peers.registry_size < this.thresholds.minPeers) {
        messages.push(`  - Low peers: ${snapshot.peers.registry_size}`);
      }
    } else {
      messages.push('Node unhealthy:');
      if (snapshot.connections.unique < this.thresholds.minConnections / 2) {
        messages.push(`  - Critical: only ${snapshot.connections.unique} connections`);
      }
      if (snapshot.peers.registry_size < this.thresholds.minPeers / 2) {
        messages.push(`  - Critical: only ${snapshot.peers.registry_size} peers`);
      }
    }

    return messages.join('\n');
  }
}
