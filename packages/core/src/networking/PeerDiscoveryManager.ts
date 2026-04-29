import { logger } from '@dechat/common';
import { Libp2p, PeerId, PeerInfo, Startable } from '@libp2p/interface';
import { debounce } from 'es-toolkit';
import { DeChatComponents, DeChatFactory } from '../types';
import { PeerAuthenticator } from './PeerAuthenticator';
import { PeerExchangeService } from './PeerExchangeService';
import { shouldDialNewPeer } from './shouldDial';

export class PeerDiscoveryManager implements Startable {
  private node: Libp2p;

  pexService: PeerExchangeService;

  peerAuthenticator: PeerAuthenticator;

  private config: DeChatComponents['config']['discovery'];

  /** Used to avoid duplicate authentication with peers */
  private authenticatingPeers: Set<string>;

  /** Debounced Function to handle burst of sudden peer discoveries */
  private onBoardNewPeerDebounced: Function;

  /** Peer Discovery Listener function */
  private peerDiscoveryListener: (event: CustomEvent<PeerInfo>) => void;

  constructor(components: DeChatComponents) {
    this.node = components.libp2p;
    this.config = components.config.discovery;
    this.pexService = components.pexService;
    this.peerAuthenticator = components.peerAuthenticator;

    this.authenticatingPeers = new Set<string>();

    this.onBoardNewPeerDebounced = debounce(
      (event: CustomEvent<PeerInfo>) => this.onBoardNewPeer(event),
      this.config.onBoardingPeerTime,
    );

    this.peerDiscoveryListener = (event: CustomEvent<PeerInfo>) => this.peerDiscoveryHandler(event);
  }

  start(): Promise<void> | void {
    this.registerPeerDiscovery();
  }

  private async requestAndDialPeers(peerId: PeerId): Promise<void> {
    logger.info(`Requesting Peers from: ${peerId.toString()}`);
    const got = await this.pexService.requestPeersFrom(peerId, 24);
    this.pexService.enqueueDial(got.slice(0, 10));
  }

  private async onBoardNewPeer(event: CustomEvent<PeerInfo>): Promise<void> {
    const peerId = event.detail.id.toString();
    try {
      if (this.authenticatingPeers.has(peerId)) {
        logger.debug('Already authenticating with: ', peerId);
        return;
      }
      this.authenticatingPeers.add(peerId);

      const isAuthenticated = await this.peerAuthenticator.runAuthClient(event.detail.id);

      if (isAuthenticated) {
        logger.info('Authentication successful with peer:', peerId);
        const addresses = (event.detail.multiaddrs || []).map((ma) => ma.toString());
        this.pexService.addPeers([{ peerId, addresses }]);
        this.pexService.initiatePeerExchange();
        await this.requestAndDialPeers(event.detail.id);
      }
    } catch (error: unknown) {
      logger.info('Error occurred while onBoarding a peer');
      logger.debug(error);
    } finally {
      this.authenticatingPeers.delete(peerId);
    }
  }

  private peerDiscoveryHandler(event: CustomEvent<PeerInfo>): void {
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

  private registerPeerDiscovery(): void {
    this.node.addEventListener('peer:discovery', this.peerDiscoveryListener);
  }

  stop() {
    this.node.removeEventListener('peer:discovery', this.peerDiscoveryListener);
  }
}

export const peerDiscoveryManager = (): DeChatFactory<PeerDiscoveryManager> => {
  return (components) => new PeerDiscoveryManager(components);
};
