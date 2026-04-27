import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { logger } from '@dechat/common';
import { generateIdProtocolPrefix } from '@dechat/crypto';
import { BootstrapComponents, bootstrap } from '@libp2p/bootstrap';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { MultiaddrConnection, PeerDiscovery, PeerId, Startable } from '@libp2p/interface';
import { MulticastDNSComponents, mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { resolveConfig } from './config/defaults';
import { DeChatConfig } from './config/types';
import {
  BasicAuthMetrics,
  BasicDialQueueMetrics,
  BasicPeerExchangeMetrics,
  BasicPeerRegistryMetrics,
  NoopAuthMetrics,
  NoopDialQueueMetrics,
  NoopPeerExchangeMetrics,
  NoopPeerRegistryMetrics,
} from './metrics';
import { genEd25519KeyPair, installAuthServer } from './networking/auth';
import { dialQueue } from './networking/DialQueue';
import { peerDiscoveryManager } from './networking/PeerDiscoveryManager';
import { peerExchangeService } from './networking/PeerExchangeService';
import { peerRegistry } from './networking/PeerRegistry';
import { SimplePeerScorer, simplePeerScorer } from './networking/SimplePeerScorer';
import { NodeKey } from './networking/types';
import { DeChatComponents, DeChatStrategies, NodeOptions } from './types';

export const getMetricsInstances = (enableMetrics: boolean) => {
  if (enableMetrics) {
    return {
      peerRegistry: new BasicPeerRegistryMetrics(),
      pexService: new BasicPeerExchangeMetrics(),
      dialQueue: new BasicDialQueueMetrics(),
      authMetrics: new BasicAuthMetrics(),
    };
  }
  return {
    peerRegistry: new NoopPeerRegistryMetrics(),
    pexService: new NoopPeerExchangeMetrics(),
    dialQueue: new NoopDialQueueMetrics(),
    authMetrics: new NoopAuthMetrics(),
  };
};

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
        globalSignaturePolicy: 'StrictSign',
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
  userOpts?: Partial<DeChatConfig>,
  strategies?: DeChatStrategies,
): Promise<{ components: DeChatComponents; start: () => Promise<void>; stop: () => Promise<void> }> => {
  const config = resolveConfig(userOpts);
  const nodeKey = await genEd25519KeyPair(nodeSeed);
  config.discovery.nodeKey = nodeKey;
  const privateKey = await generateKeyPairFromSeed('Ed25519', nodeKey.secret);

  const components = {
    config,
    strategies: {},
  } as Partial<DeChatComponents>;

  const peerDiscovery: (
    | ((components: MulticastDNSComponents) => PeerDiscovery)
    | ((components: BootstrapComponents) => PeerDiscovery)
  )[] = [];

  if (config.discovery.enableMdns) peerDiscovery.push(mdns({ interval: 10e3 }));

  if (config.network.bootstrapPeers && config.network.bootstrapPeers.length > 0)
    peerDiscovery.push(bootstrap({ list: config.network.bootstrapPeers }));

  const libp2pNode = (await createLibp2p({
    privateKey,
    addresses: { listen: config.network.listenAddrs },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
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
        globalSignaturePolicy: 'StrictSign',
      }),
    },
    connectionManager: {
      maxConnections: config.network.maxConnections,
      maxIncomingPendingConnections: config.network.maxIncomingPendingConnections,
    },
    connectionGater: {
      denyDialPeer: async (peerId: PeerId) => {
        if (!components.scorer) return false;
        const id = peerId.toString();
        const isDenied = components.scorer.get(id) < -2;
        if (isDenied) logger.debug('Denied Dialing to the peer:', id);
        return isDenied;
      },
      denyInboundConnection: async (conn: MultiaddrConnection) => {
        if (!components.scorer || !components.libp2p) return false;
        const peerId = conn.remoteAddr.getPeerId()?.toString?.() ?? '';
        const isDenied = components.scorer.get(peerId) < -5 || components.libp2p.getConnections().length >= 150;
        if (isDenied) logger.debug('Denied inbound connection to the peer:', peerId);
        return isDenied;
      },
    },
  })) as Libp2p;

  components.libp2p = libp2pNode;
  components.scorer = simplePeerScorer()(components as DeChatComponents);
  components.peerRegistry = peerRegistry()(components as DeChatComponents);
  components.dialQueue = dialQueue()(components as DeChatComponents);
  components.pexService = peerExchangeService()(components as DeChatComponents);
  components.peerDiscovery = peerDiscoveryManager()(components as DeChatComponents);

  if (strategies) {
    if (strategies.broadcast) components.strategies!.broadcast = strategies.broadcast(components as DeChatComponents);
    if (strategies.direct) components.strategies!.direct = strategies.direct(components as DeChatComponents);
    if (strategies.replicaStore)
      components.strategies!.replicaStore = strategies.replicaStore(components as DeChatComponents);
    if (strategies.contentHasher)
      components.strategies!.contentHasher = strategies.contentHasher(components as DeChatComponents);
    if (strategies.replicationProtocol)
      components.strategies!.replicationProtocol = strategies.replicationProtocol(components as DeChatComponents);
    if (strategies.dataReplication)
      components.strategies!.dataReplication = strategies.dataReplication(components as DeChatComponents);
  }

  if (userOpts?.metrics?.enabled) components.metrics = getMetricsInstances(userOpts?.metrics?.enabled);

  const finalComponents = components as DeChatComponents;

  const startables: Startable[] = [
    finalComponents.peerDiscovery,
    finalComponents.peerRegistry,
    finalComponents.pexService,
    finalComponents.dialQueue,
    finalComponents.libp2p,
  ];

  // if (nodeOptions?.peerSeeds?.length) pexService.addPeers(nodeOptions.peerSeeds);

  return {
    components: finalComponents,
    start: async () => {
      installAuthServer(libp2pNode, { pex: finalComponents.pexService, metrics: new BasicAuthMetrics() });
      for (const s of startables) await s.start();
      // Start strategies if they implement Startable
      const strategies = finalComponents.strategies;
      if (strategies.direct) await strategies.direct.start();
      if (strategies.broadcast) await strategies.broadcast.start();
      if (strategies.dataReplication) await strategies.dataReplication.start();
      if (strategies.replicationProtocol) await strategies.replicationProtocol.start();
    },
    stop: async () => {
      // Stop in reverse order
      const strategies = finalComponents.strategies;
      if (strategies.replicationProtocol) await strategies.replicationProtocol.stop();
      if (strategies.dataReplication) await strategies.dataReplication.stop();
      if (strategies.broadcast) await strategies.broadcast.stop();
      if (strategies.direct) await strategies.direct.stop();
      for (const s of [...startables].reverse()) await s.stop();
    },
  };
};
