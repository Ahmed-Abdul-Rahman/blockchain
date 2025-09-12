import { GossipSub } from '@chainsafe/libp2p-gossipsub/dist/src';
import { logger } from '@dechat/common';
import { Message, PeerId, Stream } from '@libp2p/interface';
import bloomFilters from 'bloom-filters';
import { Libp2p } from 'libp2p/dist/src';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { DialQueue } from './DialQueue';
import { PeerRegistry } from './PeerRegistry';
import { GET_PEERS_MSG, PeerInfoLite, PEX_GOSSIP, PEX_PEER_LIST, scorer } from './types';
import { filterAddrs, now, processDataFromStream, sampleList, sleep, writeToStream } from './utils';

export const PEX_PROTO = '/deChat/peer-exchange-p/1.0.0';
export const PEX_TOPIC = '/deChat/pex-t/1.0.0';

const MAX_SHARED_PEERS = 32;
const MAX_PEX_MSGS_PER_MIN = 12;
const GOSSIP_INTERVAL_MS = 5_000;

export class PeerExchangeService {
  private peerRegistry: PeerRegistry;
  private dialQ: DialQueue;
  private lastGossipByPeer = new Map<string, number>();
  private stopped = false;
  private node: Libp2p;
  private pubsub: GossipSub;
  private scorer: scorer;
  private peersSeen: bloomFilters.ScalableBloomFilter;

  constructor(node: Libp2p, scorer: scorer) {
    this.peerRegistry = new PeerRegistry(node.peerId.toString());
    this.node = node;
    this.scorer = scorer;
    this.dialQ = new DialQueue(node, { isDialable: (id) => this.isScoreEnoughToDial(id) }, 256, 750);
    this.peersSeen = new bloomFilters.ScalableBloomFilter(1000, 0.01);

    node.handle(PEX_PROTO, ({ stream, connection }) =>
      this.onPexProtocolMessage(stream, connection.remotePeer?.toString?.()),
    );

    this.pubsub = this.node.services.pubsub as GossipSub;

    this.pubsub.subscribe(PEX_TOPIC);
    this.pubsub.addEventListener('message', (event: CustomEvent<Message>) => this.onGossip(event));

    this.loopGossip().catch(() => {});
  }

  /**
   * Add peers to the registry (typically used for bootstrap peers)
   * @param peers
   */
  seed(peers: PeerInfoLite[]): void {
    this.peerRegistry.upsertMany(peers);
  }

  /**
   * Add peers to the dial queue which are new or have not been dailed for sometime
   * @param peers
   */
  enqueueDial(peers: PeerInfoLite[]): void {
    this.dialQ.enqueue(peers.filter(({ peerId }) => this.shouldDial(peerId)));
  }

  /**
   * returns true if the peer has good enough score dialing otherwise false
   * @param peerId
   * @returns boolean
   */
  private isScoreEnoughToDial(peerId: string): boolean {
    // tiny bonus: if a peer provided good PX/gossip recently, it likely has more value
    return this.scorer.isDialable(peerId); // dialQueue already checks shouldDial via injected scorer; keep hook if you expand
  }

  /**
   * returns true if this peer is new or have'nt been contact for sometime otherwise
   * @param peerId
   * @returns
   */
  shouldDial(peerId: string): boolean {
    if (this.peersSeen.has(peerId)) {
      // already seen → skip dialing
      return false;
    }
    this.peersSeen.add(peerId);
    return true;
  }

  /**
   * Handles messages received on PEX Protocol
   * @param stream
   * @param fromId
   */
  private async onPexProtocolMessage(stream: Stream, fromId?: string): Promise<void> {
    await processDataFromStream(
      stream,
      async (message) => {
        const req = message as GET_PEERS_MSG;
        if (!req) {
          if (fromId) this.scorer.penalize(fromId, 2);
          return;
        }
        if (req.type === 'GET_PEERS') {
          if (fromId) this.scorer.reward(fromId, 1); // good behavior: asks, not floods
          const share = sampleList(this.peerRegistry.getCandidates(MAX_SHARED_PEERS * 2), MAX_SHARED_PEERS).map(
            ({ peerId, addresses }) => ({
              peerId,
              addresses: filterAddrs(addresses),
            }),
          );
          const response: PEX_PEER_LIST = { type: 'PEER_LIST', peers: share };
          await writeToStream(stream, response);
        }
      },
      () => {
        if (fromId) this.scorer.penalize(fromId, 1);
      },
    );
  }

  /**
   * periodically publish a pex gossip message with other peers info on pex topic
   */
  private async loopGossip() {
    while (!this.stopped) {
      await sleep(GOSSIP_INTERVAL_MS);
      try {
        const peers = sampleList(this.peerRegistry.getCandidates(256), MAX_SHARED_PEERS).map((p) => ({
          peerId: p.peerId,
          addresses: filterAddrs(p.addresses),
        }));
        if (peers.length) {
          const msg: PEX_GOSSIP = {
            type: 'PEX_GOSSIP',
            peers,
            ts: now(),
            originPeerInfo: {
              peerId: this.node.peerId.toString(),
              addresses: this.node.getMultiaddrs().map((multiAddr) => multiAddr.toString()),
            },
          };
          await this.pubsub.publish(PEX_TOPIC, uint8ArrayFromString(JSON.stringify(msg)));
        }
      } catch (error) {
        /* noop */
        logger.warn('Error occured while publishing a gossip message to a peer: ', error);
      }
    }
  }

  /**
   * Handles messages received on pex gossip topic
   * @param event
   * @returns
   */
  private onGossip(event: CustomEvent<Message>) {
    const detail = event.detail;
    const data = detail.data;
    if (!data) return;

    const { from, type, peers } = JSON.parse(uint8ArrayToString(data));
    // inbound rate-limit per peer
    const last = this.lastGossipByPeer.get(from) || 0;
    if (now() - last < 60_000 / MAX_PEX_MSGS_PER_MIN) {
      this.scorer.penalize(from, 0.5);
      return;
    }
    this.lastGossipByPeer.set(from, now());

    if (type !== 'PEX_GOSSIP') {
      this.scorer.penalize(from, 1);
      return;
    }

    // absorb and reward
    const updatedPeers = (peers || []).slice(0, MAX_SHARED_PEERS);
    this.peerRegistry.upsertMany(updatedPeers);
    this.scorer.reward(from, Math.min(3, peers.length / 8)); // tiny reward proportional to usefulness

    // trickle dials
    this.enqueueDial(sampleList(peers, Math.min(8, peers.length)));
  }

  /**
   * Returns list of peers info from the provided peer. caps the list length to want
   * @param peerId
   * @param want
   * @returns {PeerInfoLite[]}
   */
  async requestPeersFrom(peerId: PeerId, want = 32): Promise<PeerInfoLite[]> {
    const peerIdString = peerId.toString();
    if (!this.peerRegistry.isPeerDataRequested(peerIdString)) return [];
    this.peerRegistry.markRequested(peerIdString);
    try {
      const stream = await this.node.dialProtocol(peerId, PEX_PROTO);
      const req: GET_PEERS_MSG = { type: 'GET_PEERS', want };
      let receivedPeers: PeerInfoLite[] = [];

      await writeToStream(stream, req);

      await processDataFromStream(stream, (message) => {
        const response = message as PEX_PEER_LIST;
        if (!response) this.scorer.penalize(peerIdString, 2);
        if (response.type === 'PEER_LIST') receivedPeers = response.peers ?? [];
      });

      this.peerRegistry.upsertMany(receivedPeers);
      this.scorer.reward(peerIdString, Math.min(4, receivedPeers.length / 8));
      return receivedPeers;
    } catch {
      this.scorer.penalize(peerIdString, 2);
      return [];
    }
  }

  /**
   * Stop the Peer Exchange Service from gossiping
   */
  stop(): void {
    this.stopped = true;
  }
}
