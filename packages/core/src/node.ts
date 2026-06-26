import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { logger } from '@dechat/common';
import { genEd25519KeyPair, generateIdProtocolPrefix } from '@dechat/crypto';
import { BootstrapComponents, bootstrap } from '@libp2p/bootstrap';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { isStartable, MultiaddrConnection, PeerDiscovery, PeerId, Startable } from '@libp2p/interface';
import { MulticastDNSComponents, mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { PartialDeep } from 'type-fest';
import { resolveConfig } from './config/defaults';
import { DeChatConfig } from './config/types';
import { PrefixTrie } from './data-convergence/PrefixTrie';
import { TrieBackedReplicaStore } from './data-convergence/TrieBackedReplicaStore';
import { dialQueue } from './networking/DialQueue';
import { peerAuthenticator } from './networking/PeerAuthenticator';
import { peerDiscoveryManager } from './networking/PeerDiscoveryManager';
import { peerExchangeService } from './networking/PeerExchangeService';
import { peerRegistry } from './networking/PeerRegistry';
import { simplePeerScorer } from './networking/SimplePeerScorer';
import { getGenericDataSerailizer } from './shared/serializers';
import { DeChatComponents, DeChatStrategies } from './types';
import { getMetricsInstances } from './utils';

export const createNode = async (
  infoHash: string,
  nodeSeed: string,
  userOpts?: PartialDeep<DeChatConfig>,
  strategies?: DeChatStrategies,
): Promise<{ components: DeChatComponents; start: () => Promise<void>; stop: () => Promise<void> }> => {
  const config = resolveConfig(userOpts);
  const nodeKey = await genEd25519KeyPair(nodeSeed);
  config.peerAuthenticator.nodeKey = nodeKey;
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
  components.metrics = getMetricsInstances(userOpts?.metrics?.enabled);
  components.scorer = simplePeerScorer()(components as DeChatComponents);
  components.peerRegistry = peerRegistry()(components as DeChatComponents);
  components.dialQueue = dialQueue()(components as DeChatComponents);
  components.pexService = peerExchangeService()(components as DeChatComponents);
  components.peerAuthenticator = peerAuthenticator()(components as DeChatComponents);
  components.peerDiscovery = peerDiscoveryManager()(components as DeChatComponents);
  components.serializer = getGenericDataSerailizer();

  if (strategies) {
    if (strategies.broadcast) components.strategies!.broadcast = strategies.broadcast(components as DeChatComponents);
    if (strategies.direct) components.strategies!.direct = strategies.direct(components as DeChatComponents);
    if (strategies.contentHasher)
      components.strategies!.contentHasher = strategies.contentHasher(components as DeChatComponents);
    if (strategies.replicaStore && components.strategies?.contentHasher) {
      const baseReplicaStore = strategies.replicaStore(components as DeChatComponents);
      const prefixTrie = new PrefixTrie(components.strategies.contentHasher);
      const wrappedStore = new TrieBackedReplicaStore(baseReplicaStore, prefixTrie, components.serializer);
      components.strategies!.prefixTrie = prefixTrie;
      components.strategies!.replicaStore = wrappedStore;
    }
    if (strategies.replicationProtocol)
      components.strategies!.replicationProtocol = strategies.replicationProtocol(components as DeChatComponents);
    if (strategies.dataReplication)
      components.strategies!.dataReplication = strategies.dataReplication(components as DeChatComponents);
    if (strategies.networkExchanger)
      components.strategies!.networkExchanger = strategies.networkExchanger(components as DeChatComponents);
    if (strategies.antiEntropyManager)
      components.strategies!.antiEntropyManager = strategies.antiEntropyManager(components as DeChatComponents);
  }

  const finalComponents = components as DeChatComponents;

  const startables: Startable[] = [
    finalComponents.peerAuthenticator,
    finalComponents.peerDiscovery,
    finalComponents.peerRegistry,
    finalComponents.pexService,
    finalComponents.dialQueue,
    finalComponents.libp2p,
  ];

  return {
    components: finalComponents,
    start: async () => {
      if (components.strategies?.replicaStore) {
        await components.strategies.replicaStore.init();
      }
      for (const s of startables) await s.start();
      // Start strategies if they implement Startable
      const allStrategies = Object.values(finalComponents.strategies);
      for (const strategy of allStrategies) {
        if (isStartable(strategy)) await strategy.start();
      }
    },
    stop: async () => {
      // Stop in reverse order
      const allStrategies = Object.values(finalComponents.strategies);
      for (const strategy of allStrategies) {
        if (isStartable(strategy)) await strategy.stop();
      }
      for (const s of [...startables].reverse()) await s.stop();
    },
  };
};
