import { logger } from '@dechat/common';
import { PeerInfoLite } from './types';
import { now, sampleList } from './utils';

const PEX_REQUEST_COOLDOWN_MS = 15_000;
const PEER_ENTRY_TTL_MS = 30 * 60_000;

export class PeerRegistry {
  private selfPeerId: string;
  private maxSize: number;
  private peerRegistry: Map<string, { addresses: Set<string>; lastSeen: number; lastRequested?: number }>;

  constructor(selfPeerId: string, maxSize = 50_000) {
    this.selfPeerId = selfPeerId;
    this.peerRegistry = new Map();
    this.maxSize = maxSize;

    if (process.env.NODE_ENV !== 'production') {
      this.logRegistryData();
    }
  }

  /**
   *  returns the number of peers present in registry
   * @returns {number}
   */
  getSize(): number {
    return this.peerRegistry.size;
  }

  /**
   *  returns all the peers present in registry
   * @returns {string[]}
   */
  getPeers(): string[] {
    return Array.from(this.peerRegistry.keys());
  }

  /**
   * updates the address of many peers
   * @param peers
   */
  upsertMany(peers: PeerInfoLite[]): void {
    peers.forEach((peer) => this.upsert(peer));
  }

  /**
   * updates the addresses of a given peer
   * @param peerInfo
   */
  upsert(peerInfo: PeerInfoLite): void {
    if (!peerInfo.peerId || peerInfo.peerId === this.selfPeerId) return;
    if (!this.peerRegistry.has(peerInfo.peerId) && this.peerRegistry.size >= this.maxSize) {
      let oldestId: string | null = null;
      let oldest = Infinity;
      for (const [peerId, value] of this.peerRegistry)
        if (value.lastSeen < oldest) {
          oldest = value.lastSeen;
          oldestId = peerId;
        }
      if (oldestId) this.peerRegistry.delete(oldestId); // drop oldest
    }
    const current = this.peerRegistry.get(peerInfo.peerId) ?? { addresses: new Set<string>(), lastSeen: 0 };
    for (const address of peerInfo.addresses || []) current.addresses.add(address);
    current.lastSeen = now();
    this.peerRegistry.set(peerInfo.peerId, current);
  }

  /**
   *
   * @param limit
   * @returns a random sample list of peers from the registry with the given limit
   */
  getCandidates(limit = 128): PeerInfoLite[] {
    const result: PeerInfoLite[] = [];
    const cutOff = now() - PEER_ENTRY_TTL_MS;
    for (const [peerId, value] of this.peerRegistry) {
      if (value.lastSeen < cutOff) {
        this.peerRegistry.delete(peerId);
        continue;
      }
      result.push({ peerId, addresses: [...value.addresses] });
    }
    return sampleList(result, limit);
  }

  /**
   *
   * @param peerId
   * @returns true if this peerId is eligible for requesting data again otherwise false
   */
  isPeerDataRequested(peerId: string): boolean {
    const value = this.peerRegistry.get(peerId);
    return !value || !value.lastRequested || now() - value.lastRequested > PEX_REQUEST_COOLDOWN_MS;
  }

  /**
   * mark this peer as requested by updating lastRequested value
   * @param peerId
   */
  markRequested(peerId: string): void {
    const value = this.peerRegistry.get(peerId);
    if (value) value.lastRequested = now();
  }

  private logRegistryData() {
    setInterval(() => {
      for (const [key, value] of this.peerRegistry) {
        logger.debug('peer: ', key, ' lastRequested: ', value.lastRequested);
      }
    }, 30_000);
  }
}
