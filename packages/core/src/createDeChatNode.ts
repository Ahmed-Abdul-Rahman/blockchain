import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { genEd25519KeyPair, generateIdProtocolPrefix } from '@dechat/crypto';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { isStartable, MultiaddrConnection, PeerId, Startable } from '@libp2p/interface';
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
import type { Libp2pPlatformStack } from './platform/types';
import { createWireSerializer } from './shared/serialization';
import { DeChatComponents, DeChatStrategies } from './types';
import { getMetricsInstances } from './utils';

/** Stack instance or factory invoked after config is resolved. */
export type PlatformStackInput = Libp2pPlatformStack | ((config: DeChatConfig) => Libp2pPlatformStack);

export interface CreateDeChatNodeOptions {
  readonly config?: PartialDeep<DeChatConfig>;
  readonly strategies?: DeChatStrategies;
  /** Required — inject Node or Browser {@link Libp2pPlatformStack}. */
  readonly platformStack: PlatformStackInput;
}

export type DeChatNodeHandle = {
  components: DeChatComponents;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Platform-agnostic composition root.
 * Callers must supply a {@link Libp2pPlatformStack} (see `createNode` / `createBrowserNode` facades).
 */
export const createDeChatNode = async (
  infoHash: string,
  nodeSeed: string,
  options: CreateDeChatNodeOptions,
): Promise<DeChatNodeHandle> => {
  const config = resolveConfig(options.config);
  const nodeKey = await genEd25519KeyPair(nodeSeed);
  config.peerAuthenticator.nodeKey = nodeKey;
  const privateKey = await generateKeyPairFromSeed('Ed25519', nodeKey.secret);

  const components = {
    config,
    strategies: {},
  } as Partial<DeChatComponents>;

  components.serializer = createWireSerializer(config.serialization.wireFormat);

  const stack = typeof options.platformStack === 'function' ? options.platformStack(config) : options.platformStack;

  const libp2pNode = (await createLibp2p({
    privateKey,
    addresses: { listen: [...stack.listenAddrs] },
    transports: stack.transports,
    connectionEncrypters: stack.connectionEncrypters,
    streamMuxers: stack.streamMuxers,
    peerDiscovery: stack.peerDiscovery,
    services: {
      identify: identify({
        protocolPrefix: generateIdProtocolPrefix(infoHash),
        agentVersion: 'NodeAgent-1.0.0',
      }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: false,
        gossipFactor: 1,
        globalSignaturePolicy: 'StrictSign',
      }),
      ...(stack.services ?? {}),
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
  components.metrics = getMetricsInstances(options.config?.metrics?.enabled);
  components.scorer = simplePeerScorer()(components as DeChatComponents);
  components.peerRegistry = peerRegistry()(components as DeChatComponents);
  components.dialQueue = dialQueue()(components as DeChatComponents);
  components.pexService = peerExchangeService()(components as DeChatComponents);
  components.peerAuthenticator = peerAuthenticator()(components as DeChatComponents);
  components.peerDiscovery = peerDiscoveryManager()(components as DeChatComponents);

  if (options.strategies) {
    const strategyFactories = options.strategies;
    if (strategyFactories.broadcast)
      components.strategies!.broadcast = strategyFactories.broadcast(components as DeChatComponents);
    if (strategyFactories.direct)
      components.strategies!.direct = strategyFactories.direct(components as DeChatComponents);
    if (strategyFactories.contentHasher)
      components.strategies!.contentHasher = strategyFactories.contentHasher(components as DeChatComponents);
    if (strategyFactories.replicaStore && components.strategies?.contentHasher) {
      const baseReplicaStore = strategyFactories.replicaStore(components as DeChatComponents);
      const prefixTrie = new PrefixTrie(components.strategies.contentHasher);
      const wrappedStore = new TrieBackedReplicaStore(baseReplicaStore, prefixTrie, components.serializer);
      components.strategies!.prefixTrie = prefixTrie;
      components.strategies!.replicaStore = wrappedStore;
    }
    if (strategyFactories.replicationProtocol)
      components.strategies!.replicationProtocol = strategyFactories.replicationProtocol(
        components as DeChatComponents,
      );
    if (strategyFactories.dataReplication)
      components.strategies!.dataReplication = strategyFactories.dataReplication(components as DeChatComponents);
    if (strategyFactories.networkExchanger)
      components.strategies!.networkExchanger = strategyFactories.networkExchanger(components as DeChatComponents);
    if (strategyFactories.antiEntropyManager)
      components.strategies!.antiEntropyManager = strategyFactories.antiEntropyManager(components as DeChatComponents);
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
      const allStrategies = Object.values(finalComponents.strategies);
      for (const strategy of allStrategies) {
        if (isStartable(strategy)) await strategy.start();
      }
    },
    stop: async () => {
      const allStrategies = Object.values(finalComponents.strategies);
      for (const strategy of allStrategies) {
        if (isStartable(strategy)) await strategy.stop();
      }
      for (const s of [...startables].reverse()) await s.stop();
    },
  };
};
