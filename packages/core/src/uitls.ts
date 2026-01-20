import { logger } from '@dechat/common';
import { Libp2p, PeerId, PeerInfo } from '@libp2p/interface';
import { MetricsCollector } from './metrics-collection/MetricsCollector';
import { runAuthClient } from './networking/auth';
import { PeerExchangeService } from './networking/PeerExchangeService';

export const requestAndDialPeers = async (
  peerId: PeerId,
  pexService: PeerExchangeService,
  metrics: MetricsCollector,
) => {
  logger.info(`Requesting Peers from: ${peerId.toString()}`);
  metrics.incrementPexRequest(true);

  const got = await pexService.requestPeersFrom(peerId, 24);
  metrics.incrementPexPeersShared(got.length);

  pexService.enqueueDial(got.slice(0, 10));
};

export const onBoardNewPeer = async (
  event: CustomEvent<PeerInfo>,
  node: Libp2p,
  pexService: PeerExchangeService,
  nodeKey: { secret: Uint8Array; pub: Uint8Array },
  authenticatingPeers: Set<string>,
  metrics: MetricsCollector,
): Promise<void> => {
  const peerId = event.detail.id.toString();
  const addresses = (event.detail.multiaddrs || []).map((ma) => ma.toString());
  try {
    if (authenticatingPeers.has(peerId)) {
      logger.debug('Already authenticating with: ', peerId);
      return;
    }

    metrics.incrementDialAttempt();
    authenticatingPeers.add(peerId);

    const isAuthenticated = await runAuthClient(node, event.detail.id, nodeKey.secret);

    if (isAuthenticated) {
      logger.info('Authentication successful with peer:', peerId);
      metrics.incrementPeerAuthenticated();
      metrics.incrementDialSuccess();

      pexService.addPeers([{ peerId, addresses }]);
      pexService.initiatePeerExchange();
      requestAndDialPeers(event.detail.id, pexService, metrics);
    } else {
      metrics.incrementDialFailure();
    }
  } catch (error: unknown) {
    logger.info('Error occurred while onBoarding a peer');
    logger.debug(error);
    metrics.incrementDialFailure();
  } finally {
    authenticatingPeers.delete(peerId);
  }
};
