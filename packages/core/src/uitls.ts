import { logger } from '@dechat/common';
import { Libp2p, PeerId, PeerInfo } from '@libp2p/interface';
import { runAuthClient } from './networking/auth';
import { PeerExchangeService } from './networking/PeerExchangeService';

export const requestAndDialPeers = async (peerId: PeerId, pexService: PeerExchangeService) => {
  logger.info(`Requesting Peers from: ${peerId.toString()}`);

  const got = await pexService.requestPeersFrom(peerId, 24);

  pexService.enqueueDial(got.slice(0, 10));
};

export const onBoardNewPeer = async (
  event: CustomEvent<PeerInfo>,
  node: Libp2p,
  pexService: PeerExchangeService,
  nodeKey: { secret: Uint8Array; pub: Uint8Array },
  authenticatingPeers: Set<string>,
): Promise<void> => {
  const peerId = event.detail.id.toString();
  const addresses = (event.detail.multiaddrs || []).map((ma) => ma.toString());
  try {
    if (authenticatingPeers.has(peerId)) {
      logger.debug('Already authenticating with: ', peerId);
      return;
    }

    authenticatingPeers.add(peerId);

    const isAuthenticated = await runAuthClient(node, event.detail.id, nodeKey.secret);

    if (isAuthenticated) {
      logger.info('Authentication successful with peer:', peerId);

      pexService.addPeers([{ peerId, addresses }]);
      pexService.initiatePeerExchange();
      requestAndDialPeers(event.detail.id, pexService);
    }
  } catch (error: unknown) {
    logger.info('Error occurred while onBoarding a peer');
    logger.debug(error);
  } finally {
    authenticatingPeers.delete(peerId);
  }
};
