import { logger } from '@dechat/common';
import { Libp2p, PeerId, PeerInfo } from '@libp2p/interface';
import { debounce } from 'es-toolkit';
import { runAuthClient } from './auth';
import { PeerExchangeService } from './PeerExchangeService';
import { shouldDialNewPeer } from './shouldDial';

export class PeerDiscoveryManager {
  private node: Libp2p;
  private pexService: PeerExchangeService;
  private nodeKey: { secret: Uint8Array; pub: Uint8Array };
  private authenticatingPeers: Set<string>;
  private onBoardingPeerTime: number;
  private onBoardNewPeerDebounced: Function;
  private peerDiscoveryListener: (event: CustomEvent<PeerInfo>) => void;

  constructor(
    node: Libp2p,
    nodeKey: { secret: Uint8Array; pub: Uint8Array },
    pexService: PeerExchangeService,
    onBoardingPeerTime: number = 5_000,
  ) {
    this.node = node;
    this.nodeKey = nodeKey;
    this.pexService = pexService;
    this.onBoardingPeerTime = onBoardingPeerTime;
    this.authenticatingPeers = new Set<string>();

    this.onBoardNewPeerDebounced = debounce(
      (event: CustomEvent<PeerInfo>) => this.onBoardNewPeer(event),
      this.onBoardingPeerTime,
    );

    this.peerDiscoveryListener = (event: CustomEvent<PeerInfo>) => this.peerDiscoveryHandler(event);
  }

  async requestAndDialPeers(peerId: PeerId) {
    logger.info(`Requesting Peers from: ${peerId.toString()}`);
    const got = await this.pexService.requestPeersFrom(peerId, 24);
    this.pexService.enqueueDial(got.slice(0, 10));
  }

  async onBoardNewPeer(event: CustomEvent<PeerInfo>): Promise<void> {
    const peerId = event.detail.id.toString();
    const addresses = (event.detail.multiaddrs || []).map((ma) => ma.toString());
    try {
      if (this.authenticatingPeers.has(peerId)) {
        logger.debug('Already authenticating with: ', peerId);
        return;
      }
      this.authenticatingPeers.add(peerId);

      const isAuthenticated = await runAuthClient(this.node, event.detail.id, this.nodeKey.secret);

      if (isAuthenticated) {
        logger.info('Authentication successful with peer:', peerId);

        this.pexService.addPeers([{ peerId, addresses }]);
        this.pexService.initiatePeerExchange();
        this.requestAndDialPeers(event.detail.id);
      }
    } catch (error: unknown) {
      logger.info('Error occurred while onBoarding a peer');
      logger.debug(error);
    } finally {
      this.authenticatingPeers.delete(peerId);
    }
  }

  async peerDiscoveryHandler(event: CustomEvent<PeerInfo>): Promise<void> {
    const peerId = event.detail.id.toString();
    logger.info('Peer Discovered:', peerId);

    if (this.pexService.peerRegistry.getSize() > 0) {
      if (shouldDialNewPeer(this.node.peerId.toString(), peerId, this.pexService.peerRegistry.getPeers())) {
        logger.trace('Elected dialing new peer');
        this.onBoardNewPeer(event);
      }
    } else {
      logger.trace('onBoardNewPeerDebounced triggered');
      this.onBoardNewPeerDebounced(event);
    }
  }

  registerPeerDiscovery(): void {
    this.node.addEventListener('peer:discovery', this.peerDiscoveryListener);
  }

  cleanUp() {
    this.node.removeEventListener('peer:discovery', this.peerDiscoveryListener);
  }
}
