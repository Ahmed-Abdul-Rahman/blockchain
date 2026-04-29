import { logger } from '@dechat/common';
import { Connection, Libp2p, Startable } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { DialQueueMetrics } from '../metrics/interfaces/DialQueueMetrics.js';
import { DeChatComponents, DeChatFactory } from '../types.js';
import { PeerInfoLite } from './types.js';

export class DialQueue implements Startable {
  private node: Libp2p;

  /** Scorer to determine if peer is worth dialing and maintaining a connection */
  private scorer: DeChatComponents['scorer'];

  private config: DeChatComponents['config']['dialQueue'];

  /** Current Peers in the queue to be dialed */
  private dialQueue: Array<PeerInfoLite> = [];

  /** Indicates if the peers in the dial queue are being dialed */
  private isQueueRunning: boolean = false;

  /** Interval Id of the dial queue loop */
  private loopIntervalId: NodeJS.Timeout | null = null;

  private readonly metrics: DialQueueMetrics;

  constructor(components: DeChatComponents) {
    this.node = components.libp2p;
    this.config = components.config.dialQueue;
    this.scorer = components.scorer;
    this.metrics = components.metrics.dialQueue;
  }

  start(): void {}

  /**
   * returns a list of unique remotePeerId connections that are open
   * @returns
   */
  getConnections(): Connection[] {
    const seen = new Set<string>();
    return this.node.getConnections().filter(({ remotePeer, status }) => {
      const remotePeerId = remotePeer.toString();
      if (status !== 'open') return false;
      if (seen.has(remotePeerId)) return false;
      seen.add(remotePeerId);
      return true;
    });
  }

  /**
   * returns a list of peerId Connections that are open
   * @param peerId
   * @returns
   */
  getRemotePeerConnections(peerId: string): Connection[] {
    const remotePeerId = peerIdFromString(peerId);
    return this.node.getConnections(remotePeerId).filter(({ status }) => {
      if (status !== 'open') return false;
      return true;
    });
  }

  getTargetConnections(): number {
    const configMax = this.config.maxConnections ?? 150;
    const n = this.dialQueue.length + this.getConnections().length;
    const adaptive = Math.floor(Math.log2(Math.max(2, n))) + this.config.buffer;
    return Math.min(configMax, Math.max(this.config.minConnections, adaptive));
  }

  /**
   * add peers to the dial queue and start dialing
   * @param peers
   */
  async enqueue(peers: PeerInfoLite[]): Promise<void> {
    for (const peer of peers) {
      if (this.dialQueue.length >= this.config.maxQueueLength) break;
      if (this.node.peerId.toString() === peer.peerId) continue; // don't enqueue self
      if (this.getRemotePeerConnections(peer.peerId).length > 3) continue;
      this.dialQueue.push(peer);
      this.metrics.peerEnqueued(peer.peerId);
    }
    if (!this.loopIntervalId) this.loopIntervalId = this.loop();
  }

  /**
   * periodically dials peers until the dial queue is empty
   */
  private loop(): NodeJS.Timeout {
    this.isQueueRunning = false;
    return setInterval(async () => {
      if (this.isQueueRunning) return;
      this.isQueueRunning = true;
      try {
        const target = this.getTargetConnections();
        const activeConnections = this.getConnections();
        const connectedPeerIds = new Set(activeConnections.map((connection) => connection.remotePeer.toString()));
        let currentCount = connectedPeerIds.size;

        while (currentCount < target && this.dialQueue.length > 0) {
          const peerInfo = this.dialQueue.shift();
          if (!peerInfo) break;
          const peerIdStr = peerInfo.peerId;

          if (
            !this.scorer.isDialable(peerIdStr) ||
            this.node.peerId.equals(peerIdStr) ||
            this.getRemotePeerConnections(peerIdStr).length > 1
          )
            continue;

          try {
            this.metrics.dialAttempt();
            await this.node.dial(peerIdFromString(peerIdStr));
            this.metrics.dialSucceeded();
            connectedPeerIds.add(peerIdStr);
            currentCount++;
          } catch (error) {
            // TODO: If the dialing failed consistently maybe for twice or thrice remove this peer from registry
            logger.warn(`Failed to dial peer ${peerIdStr} `, error);
            logger.debug(error);
            this.metrics.dialFailed('error');
          }
        }
        logger.debug('Total unique connections with remotePeers: ', currentCount);
        this.metrics.targetConnectionsComputed(target);
      } catch (error) {
        logger.error('Critical error in DialQueue loop: ', error);
      } finally {
        this.isQueueRunning = false;
      }
    }, this.config.intervalMs);
  }

  /**
   * clears the Dial loop interval function
   */
  clearDialInterval(): void {
    if (this.loopIntervalId) {
      clearInterval(this.loopIntervalId);
      this.loopIntervalId = null;
    }
  }

  stop(): void {
    if (this.loopIntervalId) {
      clearInterval(this.loopIntervalId);
      this.loopIntervalId = null;
    }
    this.dialQueue = [];
    this.isQueueRunning = false;
  }
}

export const dialQueue = (): DeChatFactory<DialQueue> => {
  return (components) => new DialQueue(components);
};
