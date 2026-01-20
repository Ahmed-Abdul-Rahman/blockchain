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
import { HealthChecker } from './metrics-collection/HealthChecker';
import { MetricsCollector } from './metrics-collection/MetricsCollector';
import { genEd25519KeyPair, installAuthServer } from './networking/auth';
import { PeerExchangeService } from './networking/PeerExchangeService';
import { SimplePeerScorer } from './networking/SimplePeerScorer';
import { shouldDialNewPeer } from './networking/shouldDial';
import { NodeKey } from './networking/types';
import { NodeComponents, NodeOptions } from './types';
import { onBoardNewPeer } from './uitls';

export const createLibp2pNode = async (
  infoHash: string,
  nodeSeed: string,
  scorer: SimplePeerScorer,
  nodeOptions?: NodeOptions,
): Promise<{
  node: Libp2p;
  nodeKey: NodeKey;
}> => {
  const nodeKey = await genEd25519KeyPair(nodeSeed);
  const privateKey = await generateKeyPairFromSeed('Ed25519', nodeKey.secret);
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
        const isDenied = scorer.get(id) < -2;
        if (isDenied) logger.debug('Denied Dialing to the peer:', id);
        return isDenied;
      },
      denyInboundConnection: async (conn) => {
        const peerId = conn.remoteAddr.getPeerId()?.toString?.() ?? '';
        const isDenied = scorer.get(peerId) < -5 || node.getConnections().length >= 150;
        if (isDenied) logger.debug('Denied inbound connection to the peer:', peerId);
        return isDenied;
      },
    },
  })) as Libp2p;

  return { node, nodeKey };
};

export const createNode = async (
  infoHash: string,
  nodeSeed: string,
  nodeOptions?: NodeOptions,
): Promise<NodeComponents> => {
  const scorer = new SimplePeerScorer();

  const { node, nodeKey } = await createLibp2pNode(infoHash, nodeSeed, scorer, nodeOptions);

  const metrics = new MetricsCollector(node);
  const health = new HealthChecker(node, metrics);
  const pexService = new PeerExchangeService(node, {
    reward: (peerId, amount) => scorer.reward(peerId, amount),
    penalize: (peerId, amount) => scorer.penalize(peerId, amount),
    isDialable: (peerId) => scorer.isDialable(peerId),
  });

  if (nodeOptions?.peerSeeds?.length) pexService.addPeers(nodeOptions.peerSeeds);

  const authenticatingPeers = new Set<string>();
  installAuthServer(node, { pex: pexService });

  const onBoardNewPeerDebounced = debounce(
    (event: CustomEvent<PeerInfo>) => onBoardNewPeer(event, node, pexService, nodeKey, authenticatingPeers, metrics),
    nodeOptions?.onBoardingPeerTime || 5_000,
  );

  const peerDiscoveryListener = async (event: CustomEvent<PeerInfo>) => {
    const peerId = event.detail.id.toString();
    logger.info('Peer Discovered:', peerId);
    metrics.incrementPeerDiscovered();

    if (pexService.peerRegistry.getSize() > 0) {
      if (shouldDialNewPeer(node.peerId.toString(), peerId, pexService.peerRegistry.getPeers())) {
        logger.trace('Elected dialing new peer');
        onBoardNewPeer(event, node, pexService, nodeKey, authenticatingPeers, metrics);
      }
    } else {
      logger.trace('onBoardNewPeerDebounced triggered');
      onBoardNewPeerDebounced(event);
    }
  };

  const decayInterval = setInterval(() => scorer.decay(), 60_000);
  node.addEventListener('peer:discovery', peerDiscoveryListener);

  // Start metrics collection if enabled
  if (nodeOptions?.enableMetrics !== false) metrics.startPeriodicCollection(nodeOptions?.metricsInterval || 30_000);

  const nodeCleanUp = () => {
    node.removeEventListener('peer:discovery', peerDiscoveryListener);
    clearInterval(decayInterval);
    metrics.stopPeriodicCollection();
    pexService.cleanUp();
  };

  return { node, scorer, pexService, metrics, health, nodeCleanUp };
};
