import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { Libp2p, Message, PeerId, Stream } from '@libp2p/interface';
import bloomFilters from 'bloom-filters';
import { delay } from 'es-toolkit';
import { LRUCache } from 'lru-cache';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { PeerExchangeServiceMetrics } from '../metrics/interfaces/PeerExchangeServiceMetrics';
import { GOSSIP_INTERVAL_MS, MAX_PEX_MSGS_PER_MIN, MAX_SHARED_PEERS } from './configurations';
import { DialQueue } from './DialQueue';
import { PeerRegistry } from './PeerRegistry';
import { PEX_PROTOCOL, PEX_TOPIC } from './protocols';
import { SimplePeerScorer } from './SimplePeerScorer';
import { GET_PEERS_MSG, PEX_GOSSIP, PEX_PEER_LIST, PeerInfoLite } from './types';
import { filterAddrs, now, processDataFromStream, publishWithRetry, sampleList, writeToStream } from './utils';

export class PeerExchangeService {
  readonly peerRegistry: PeerRegistry;
  private dialQ: DialQueue;
  private lastGossipByPeer = new LRUCache<string, number>({
    max: 10000,
    ttl: 10 * 60 * 1000, // 10 minutes
  });
  private isPeerExchangeStarted: boolean = false;
  private node: Libp2p;
  private pubsub: GossipSub;
  private scorer: SimplePeerScorer;
  private peersSeen: bloomFilters.ScalableBloomFilter;
  private gossipListener: (event: CustomEvent<Message>) => void;

  constructor(
    node: Libp2p,
    scorer: SimplePeerScorer,
    dialQ: DialQueue,
    peerRegistry: PeerRegistry,
    private readonly metrics: PeerExchangeServiceMetrics,
  ) {
    this.node = node;
    this.scorer = scorer;
    this.dialQ = dialQ;
    this.peerRegistry = peerRegistry;
    this.peersSeen = new bloomFilters.ScalableBloomFilter(1000, 0.01);

    node.handle(PEX_PROTOCOL, ({ stream, connection }) =>
      this.onPexProtocolMessage(stream, connection.remotePeer.toString()),
    );

    this.pubsub = this.node.services.pubsub as GossipSub;

    this.pubsub.subscribe(PEX_TOPIC);
    this.gossipListener = (event: CustomEvent<Message>) => this.onGossip(event);
    this.pubsub.addEventListener('message', this.gossipListener);
  }

  /**
   * Add peers to the registry
   * @param peers
   */
  addPeers(peers: PeerInfoLite[]): void {
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
   * Start exchanging peers on the pex topic
   */
  async initiatePeerExchange(): Promise<void> {
    if (!this.isPeerExchangeStarted) {
      this.isPeerExchangeStarted = true;
      this.loopGossip();
    }
  }

  /**
   * returns true if this peer is new or have'nt been contacted for sometime otherwise
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
    logger.trace('PeerExchangeService - onPexProtocolMessage - entry');
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
    logger.trace('PeerExchangeService - onPexProtocolMessage - exit');
  }

  /**
   * periodically publish a pex gossip message with other peers info on pex topic
   */
  private async loopGossip(): Promise<void> {
    logger.info('Registered Peer Exchange Topic');
    while (this.isPeerExchangeStarted) {
      try {
        const peers = sampleList(this.peerRegistry.getCandidates(256), MAX_SHARED_PEERS).map((p) => ({
          peerId: p.peerId,
          addresses: filterAddrs(p.addresses),
        }));
        if (peers.length) {
          const msg: PEX_GOSSIP = {
            from: this.node.peerId.toString(),
            type: 'PEX_GOSSIP',
            peers,
            ts: now(),
            originPeerInfo: {
              peerId: this.node.peerId.toString(),
              addresses: this.node.getMultiaddrs().map((multiAddr) => multiAddr.toString()),
            },
          };
          await delay(GOSSIP_INTERVAL_MS);
          await publishWithRetry(this.pubsub, PEX_TOPIC, uint8ArrayFromString(JSON.stringify(msg)), {
            retries: 7,
            baseDelay: GOSSIP_INTERVAL_MS,
          });
          logger.trace('Published peers info on pex topic');
        }
      } catch (error: unknown) {
        logger.warn('Error occured while publishing a gossip message to a peer');
        logger.debug(error);
        if ((error as Error)?.message === 'publishWithRetry: exhausted retries') {
          logger.info('All publish retry attempts exhausted, stopping peer exchange delivery');
          this.stopGossip();
        }
      }
    }
  }

  /**
   * Validates the Peer Gossip exchange Message
   * @param msg
   * @returns
   */
  private validatePexMessage(msg: unknown): msg is PEX_GOSSIP {
    return (
      typeof msg === 'object' &&
      msg !== null &&
      'type' in msg &&
      msg.type === 'PEX_GOSSIP' &&
      'peers' in msg &&
      Array.isArray(msg.peers) &&
      msg.peers.length <= MAX_SHARED_PEERS
    );
  }

  /**
   * Handles messages received on pex gossip topic
   * @param event
   * @returns
   */
  private onGossip(event: CustomEvent<Message>): void {
    const data = event.detail.data;
    if (!data || event.detail.topic !== PEX_TOPIC) return;
    logger.trace('PeerExchangeService - onGossip - entry');
    try {
      const parsedData = JSON.parse(uint8ArrayToString(data));

      if (!this.validatePexMessage(parsedData)) {
        this.scorer.penalize(parsedData.from, 5);
        return;
      }

      const { from, type, peers, originPeerInfo } = parsedData;
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

      logger.trace('Received pex gossip message from: ', originPeerInfo?.peerId);
      // absorb and reward
      const updatedPeers = (peers || []).slice(0, MAX_SHARED_PEERS);
      this.peerRegistry.upsertMany(updatedPeers);
      if (originPeerInfo) this.peerRegistry.upsert(originPeerInfo);

      this.scorer.reward(from, Math.min(3, peers.length / 8)); // tiny reward proportional to usefulness

      // trickle dials
      this.enqueueDial(sampleList(peers, Math.min(8, peers.length)));
      logger.trace('PeerExchangeService - onGossip - exit');
    } catch (error: unknown) {
      logger.warn('Error occured while receiving gossip message');
      logger.debug(error);
    }
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
    logger.trace('PeerExchangeService - requestPeersFrom - entry');
    try {
      this.metrics.exchangeRequested();
      const stream = await this.node.dialProtocol(peerId, PEX_PROTOCOL);
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
      logger.trace('PeerExchangeService - requestPeersFrom - exit');
      this.metrics.exchangeResponded();
      return receivedPeers;
    } catch (error: unknown) {
      logger.info('Error Occured while requesting peers');
      logger.debug(error);
      this.scorer.penalize(peerIdString, 2);
      logger.trace('PeerExchangeService - requestPeersFrom - catch - exit');
      return [];
    }
  }

  /**
   * Stop the Peer Exchange Service from gossiping
   */
  stopGossip(): void {
    this.isPeerExchangeStarted = false;
  }

  /**
   * clears intervals, gossips and loops
   */
  cleanUp(): void {
    this.stopGossip();
    this.dialQ.stop();
    this.peerRegistry.cleanUp();
    this.pubsub.removeEventListener('message', this.gossipListener);
  }
}
