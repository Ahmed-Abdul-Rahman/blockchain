import { peerIdFromString } from '@libp2p/peer-id';
import { Libp2p } from 'libp2p/dist/src';
import logger from '@common/logger';

type PeerInfoLite = { peerId: string; addresses: string[] };

export class DialQueue {
  private dialQueue: Array<PeerInfoLite>;
  private running: boolean;
  private node: Libp2p;
  private scorer: { isDialable: (peerId: string) => boolean };
  private max: number;
  private intervalMs: number;

  constructor(
    node: Libp2p,
    scorer: { isDialable: (peerId: string) => boolean },
    max: number = 256,
    intervalMs: number = 750,
  ) {
    this.node = node;
    this.scorer = scorer;
    this.max = max;
    this.intervalMs = intervalMs;
    this.dialQueue = [];
    this.running = false;
  }

  /**
   * add peers to the dial queue and start dialing
   * @param peers
   */
  enqueue(peers: PeerInfoLite[]): void {
    for (const peer of peers) {
      if (this.dialQueue.length >= this.max) break;
      if (this.node.peerId.toString() === peer.peerId) continue; // don't enqueue self
      this.dialQueue.push(peer);
    }
    if (!this.running) this.loop();
  }

  /**
   * periodically dials peers until the dial queue is empty
   */
  private async loop(): Promise<void> {
    this.running = true;
    while (this.dialQueue.length) {
      console.log('Dial queue length', this.dialQueue);
      const peerInfo = this.dialQueue.shift();
      try {
        if (!peerInfo) break;
        if (
          !this.scorer.isDialable(peerInfo.peerId) ||
          this.node.peerId.equals(peerInfo.peerId) ||
          this.node.getConnections(peerIdFromString(peerInfo.peerId)).length > 0
        ) {
          await this.sleep(this.intervalMs);
          continue;
        }

        // pick a usable addr if you pass multiaddrs; or dial by peerId if peerstore hydrated

        const connection = await this.node.dial(peerIdFromString(peerInfo.peerId));

        await connection.close();
      } catch (error) {
        /* swallow; optional retry policy */
        logger.warn('Error occured while dialing a peer in queue');
        logger.debug(error);
      }
      await this.sleep(this.intervalMs);
    }
    this.running = false;
  }

  /**
   * sleep for sometime
   * @param ms
   * @returns
   */
  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
