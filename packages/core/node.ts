import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { PeerId, PeerInfo } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { debounce } from 'lodash-es';
import logger from '@common/logger';
import { generateIdProtocolPrefix } from '@common/utils';
import { genEd25519KeyPair, installAuthServer, runAuthClient } from './auth';
import { PeerExchangeService } from './PeerExchangeService';
import { SimplePeerScorer } from './SimplePeerScorer';

const requestAndDialPeers = async (peerId: PeerId, pexService: PeerExchangeService) => {
  logger.info(`Requesting Peers from: ${peerId.toString()}`);
  const got = await pexService.requestPeersFrom(peerId, 24);
  pexService.enqueueDial(got.slice(0, 6));
};

export const createNode = async (
  infoHash: string,
  opts?: {
    seeds?: { peerId: string; addresses: string[] }[];
  },
): Promise<{
  node: Libp2p;
  scorer: SimplePeerScorer;
  pexService: PeerExchangeService;
}> => {
  const scorer = new SimplePeerScorer();

  const node = (await createLibp2p({
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [mdns({ interval: 10e3 })],
    services: {
      identify: identify({
        protocolPrefix: generateIdProtocolPrefix(infoHash),
        agentVersion: 'NodeAgent-1.0.0',
      }),
      pubsub: gossipsub({
        // tune as desired; keep scoring ON in gossipsub if you enable it later
        emitSelf: false,
        allowPublishToZeroTopicPeers: false,
      }),
    },

    // keep the node stable under load
    connectionManager: {
      maxConnections: 150,
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

  const nodeKey = await genEd25519KeyPair();

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
  if (opts?.seeds?.length) pexService.seed(opts.seeds);

  const requestAndDialPeersDe = debounce(requestAndDialPeers, 1000, { trailing: true });

  // discovery: record + gentle pull + trickle dials (do NOT dial everything)
  node.addEventListener('peer:discovery', async (event: CustomEvent<PeerInfo>) => {
    const peerId = event.detail.id.toString();
    const addresses = (event.detail.multiaddrs || []).map((ma) => ma.toString());
    logger.info('Peer Discovered: ', peerId);

    if (node.peerId.toString() < peerId.toString()) {
      const response = await runAuthClient(node, event.detail.id, nodeKey.secret);

      if (response) {
        logger.info('Authentication succesful with peer: ', peerId);
        pexService.seed([{ peerId, addresses }]);
      }

      requestAndDialPeersDe(event.detail.id, pexService);
    }
  });

  return { node, scorer, pexService };
};
