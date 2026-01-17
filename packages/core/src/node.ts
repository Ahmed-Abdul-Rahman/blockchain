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
import { LifecycleManager } from './lifeCycleManager';
import { HealthChecker } from './metricsCollection/HealthChecker';
import { MetricsCollector } from './metricsCollection/MetricsCollector';
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
  enableMetrics?: boolean;
  metricsInterval?: number;
}

export interface NodeComponents {
  node: Libp2p;
  scorer: SimplePeerScorer;
  pexService: PeerExchangeService;
  lifecycle: LifecycleManager;
  metrics: MetricsCollector;
  health: HealthChecker;
}

const requestAndDialPeers = async (peerId: PeerId, pexService: PeerExchangeService, metrics: MetricsCollector) => {
  logger.info(`Requesting Peers from: ${peerId.toString()}`);
  metrics.incrementPexRequest(true);

  const got = await pexService.requestPeersFrom(peerId, 24);
  metrics.incrementPexPeersShared(got.length);

  pexService.enqueueDial(got.slice(0, 10));
};

const onBoardNewPeer = async (
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

export const createNode = async (
  infoHash: string,
  nodeSeed: string,
  nodeOptions?: NodeOptions,
): Promise<NodeComponents> => {
  const lifecycle = new LifecycleManager({
    onInitializing: async () => {
      logger.info('Node initializing...');
    },
    onStarting: async () => {
      logger.info('Node starting...');
    },
    onRunning: async () => {
      logger.info('Node is now running');
    },
    onStopping: async () => {
      logger.info('Node stopping...');
    },
    onStopped: async () => {
      logger.info('Node stopped');
    },
    onError: async (error?: Error) => {
      logger.error('Node encountered error:', error);
    },
  });

  await lifecycle.initialize();

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

  lifecycle.setNode(node);

  // Initialize metrics
  const metrics = new MetricsCollector(node);
  const health = new HealthChecker(node, metrics);
  const authenticatingPeers = new Set<string>();

  // Register cleanup tasks
  lifecycle.registerCleanupTask(async () => {
    logger.info('Stopping metrics collection...');
    metrics.stopPeriodicCollection();
  });

  const decayInterval = setInterval(() => scorer.decay(), 60_000);
  lifecycle.registerCleanupTask(async () => {
    clearInterval(decayInterval);
  });

  // PEX service
  const pexService = new PeerExchangeService(node, {
    reward: (peerId, amount) => scorer.reward(peerId, amount),
    penalize: (peerId, amount) => scorer.penalize(peerId, amount),
    isDialable: (peerId) => scorer.isDialable(peerId),
  });

  installAuthServer(node, { pex: pexService });

  if (nodeOptions?.peerSeeds?.length) pexService.addPeers(nodeOptions.peerSeeds);

  const onBoardNewPeerDebounced = debounce(
    (event: CustomEvent<PeerInfo>) => onBoardNewPeer(event, node, pexService, nodeKey, authenticatingPeers, metrics),
    nodeOptions?.onBoardingPeerTime || 5_000,
  );

  node.addEventListener('peer:discovery', async (event: CustomEvent<PeerInfo>) => {
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
  });

  // Start metrics collection if enabled
  if (nodeOptions?.enableMetrics !== false) {
    metrics.startPeriodicCollection(nodeOptions?.metricsInterval || 30_000);
  }

  await lifecycle.start();

  return { node, scorer, pexService, lifecycle, metrics, health };
};
