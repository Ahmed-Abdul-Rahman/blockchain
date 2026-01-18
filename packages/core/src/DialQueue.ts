import { logger } from '@dechat/common';
import { Connection, Libp2p } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { PeerInfoLite } from './types.js';

export class DialQueue {
  private node: Libp2p;
  private scorer: { isDialable: (peerId: string) => boolean };
  private maxQueueLength: number;
  private maxConnections: number;
  private minConnections: number;
  private intervalMs: number;
  private dialQueue: Array<PeerInfoLite> = [];
  private isQueueRunning: boolean = false;
  private loopIntervalId: NodeJS.Timeout | null = null;
  private buffer: number = 5;

  constructor(
    node: Libp2p,
    scorer: { isDialable: (peerId: string) => boolean },
    maxQueueLength: number = 256,
    intervalMs: number = 10_000,
    minConnections: number = 8,
    maxConnections: number = 50,
  ) {
    this.node = node;
    this.scorer = scorer;
    this.maxQueueLength = maxQueueLength;
    this.intervalMs = intervalMs;
    this.minConnections = minConnections;
    this.maxConnections = maxConnections;
  }

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
    const configMax = this.maxConnections ?? 150;
    const n = this.dialQueue.length + this.getConnections().length;
    const adaptive = Math.floor(Math.log2(Math.max(2, n))) + this.buffer;
    return Math.min(configMax, Math.max(this.minConnections, adaptive));
  }

  /**
   * add peers to the dial queue and start dialing
   * @param peers
   */
  async enqueue(peers: PeerInfoLite[]): Promise<void> {
    for (const peer of peers) {
      if (this.dialQueue.length >= this.maxQueueLength) break;
      if (this.node.peerId.toString() === peer.peerId) continue; // don't enqueue self
      if (this.getRemotePeerConnections(peer.peerId).length > 3) continue;
      this.dialQueue.push(peer);
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
      const target = this.getTargetConnections();

      while (this.getConnections().length < target) {
        const peerInfo = this.dialQueue.shift();
        try {
          if (!peerInfo) break;
          if (
            !this.scorer.isDialable(peerInfo.peerId) ||
            this.node.peerId.equals(peerInfo.peerId) ||
            this.getRemotePeerConnections(peerInfo.peerId).length > 1
          )
            continue;

          await this.node.dial(peerIdFromString(peerInfo.peerId));
        } catch (error) {
          // If the dialing failed consistently maybe for twice or thrice remove this peer from registry
          logger.warn('Error occured while dialing a peer in queue');
          logger.debug(error);
        }
      }
      logger.debug('Total unique connections with remotePeers: ', this.getConnections().length);
      this.isQueueRunning = false;
    }, this.intervalMs);
  }

  /**
   * clears the Dial loop interval function
   */
  clearDialInterval(): void {
    if (this.loopIntervalId) clearInterval(this.loopIntervalId);
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
