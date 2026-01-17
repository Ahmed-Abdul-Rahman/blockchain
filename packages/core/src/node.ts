import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { logger } from '@dechat/common';
import { generateIdProtocolPrefix } from '@dechat/crypto';
import { BootstrapComponents, bootstrap } from '@libp2p/bootstrap';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { PeerDiscovery, PeerId, PeerInfo } from '@libp2p/interface';
import { MulticastDNSComponents, mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { debounce } from 'es-toolkit';
import { createLibp2p, Libp2p } from 'libp2p';
import { genEd25519KeyPair, installAuthServer, runAuthClient } from './auth';
import { PeerExchangeService } from './PeerExchangeService';
import { SimplePeerScorer } from './SimplePeerScorer';
import { shouldDialNewPeer } from './shouldDial';

export interface NodeOptions {
  mdns?: boolean;
  listenTcp?: string[]; // override listen multiaddrs
  bootstrap?: string[]; // override bootstrap multiaddrs
  peerSeeds?: { peerId: string; addresses: string[] }[];
  onBoardingPeerTime?: number;
  maxConnections?: number;
}

const requestAndDialPeers = async (peerId: PeerId, pexService: PeerExchangeService) => {
  logger.info(`Requesting Peers from: ${peerId.toString()}`);
  const got = await pexService.requestPeersFrom(peerId, 24);
  pexService.enqueueDial(got.slice(0, 10));
};

const onBoardNewPeer = async (
  event: CustomEvent<PeerInfo>,
  node: Libp2p,
  pexService: PeerExchangeService,
  nodeKey: { secret: Uint8Array; pub: Uint8Array },
  authenticatingPeers: Set<string>,
): Promise<void> => {
  const peerId = event.detail.id.toString();
  const addresses = (event.detail.multiaddrs || []).map((ma) => ma.toString());

  if (authenticatingPeers.has(peerId)) {
    logger.debug('Already authenticating with: ', peerId);
    return;
  }

  authenticatingPeers.add(peerId);

  try {
    const isAuthenticated = await runAuthClient(node, event.detail.id, nodeKey.secret);
    if (isAuthenticated) {
      logger.info('Authentication succesful with peer: ', peerId);
      pexService.addPeers([{ peerId, addresses }]);
      pexService.initiatePeerExchange();
      requestAndDialPeers(event.detail.id, pexService);
    }
  } catch (error: unknown) {
    logger.info('Error occured while onBoarding a peer');
    logger.debug(error);
  } finally {
    authenticatingPeers.delete(peerId);
  }
};

export const createNode = async (
  infoHash: string,
  nodeSeed: string,
  nodeOptions?: NodeOptions,
): Promise<{
  node: Libp2p;
  scorer: SimplePeerScorer;
  pexService: PeerExchangeService;
}> => {
  const nodeKey = await genEd25519KeyPair(nodeSeed);
  const privateKey = await generateKeyPairFromSeed('Ed25519', nodeKey.secret);
  const scorer = new SimplePeerScorer();

  const listenAddrs = nodeOptions?.listenTcp ?? ['/ip4/0.0.0.0/tcp/0'];
  const transports = [tcp()];
  const streamMuxers = [yamux()];
  const connectionEncrypters = [noise()];

  const peerDiscovery: (
    | ((components: MulticastDNSComponents) => PeerDiscovery)
    | ((components: BootstrapComponents) => PeerDiscovery)
  )[] = [];
  if (nodeOptions?.mdns !== false) peerDiscovery.push(mdns({ interval: 10e3 }));

  if (nodeOptions?.bootstrap && nodeOptions.bootstrap.length > 0)
    peerDiscovery.push(bootstrap({ list: nodeOptions.bootstrap }));

  const node = (await createLibp2p({
    privateKey,
    addresses: { listen: listenAddrs },
    transports,
    connectionEncrypters,
    streamMuxers,
    peerDiscovery,
    services: {
      identify: identify({
        protocolPrefix: generateIdProtocolPrefix(infoHash),
        agentVersion: 'NodeAgent-1.0.0',
      }),
      pubsub: gossipsub({
        // tune as desired; keep scoring ON in gossipsub if you enable it later
        emitSelf: false,
        allowPublishToZeroTopicPeers: false,
        gossipFactor: 1,
      }),
    },

    // keep the node stable under load
    connectionManager: {
      maxConnections: nodeOptions?.maxConnections ?? 150,
      maxIncomingPendingConnections: 20,
    },

    // gate by score to avoid wasting resources
    connectionGater: {
      denyDialPeer: async (peerId) => {
        const id = peerId.toString();
        const isDenied = scorer.get(id) < -2; // too low, don't dial
        if (isDenied) logger.debug('Denied Dialing to the peer: ', id);
        return isDenied;
      },
      denyInboundConnection: async (conn) => {
        const peerId = conn.remoteAddr.getPeerId()?.toString?.() ?? '';
        // soft gate on inbound; also cap total
        const isDenied = scorer.get(peerId) < -5 || node.getConnections().length >= 150;
        if (isDenied) logger.debug('Denied inbound connection to the peer: ', peerId);
        return isDenied;
      },
    },
  })) as Libp2p;

  const authenticatingPeers = new Set<string>();
  // optional: decay every minute
  setInterval(() => scorer.decay(), 60_000);

  // PEX service
  const pexService = new PeerExchangeService(node, {
    reward: (peerId, amount) => scorer.reward(peerId, amount),
    penalize: (peerId, amount) => scorer.penalize(peerId, amount),
    isDialable: (peerId) => scorer.isDialable(peerId),
  });

  installAuthServer(node, { pex: pexService });

  // seed (optional but recommended for internet-wide discovery)
  if (nodeOptions?.peerSeeds?.length) pexService.addPeers(nodeOptions.peerSeeds);

  const onBoardNewPeerDebounced = debounce(onBoardNewPeer, nodeOptions?.onBoardingPeerTime || 5_000);

  node.addEventListener('peer:discovery', async (event: CustomEvent<PeerInfo>) => {
    const peerId = event.detail.id.toString();
    logger.info('Peer Discovered: ', {
      peerId,
      multiaddrs: event.detail.multiaddrs.length,
      registrySize: pexService.peerRegistry.getSize(),
    });

    if (pexService.peerRegistry.getSize() > 0) {
      if (shouldDialNewPeer(node.peerId.toString(), peerId, pexService.peerRegistry.getPeers())) {
        logger.trace('Elected dailing new peer');
        onBoardNewPeer(event, node, pexService, nodeKey, authenticatingPeers);
      }
    } else {
      logger.trace('onBoardNewPeerDebounced triggered');
      onBoardNewPeerDebounced(event, node, pexService, nodeKey, authenticatingPeers);
    }
  });

  return { node, scorer, pexService };
};
