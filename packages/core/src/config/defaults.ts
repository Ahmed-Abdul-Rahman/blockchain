import { merge, random } from 'es-toolkit';
import { PartialDeep } from 'type-fest';
import { DeChatConfig, ValidationRule } from './types';

export const DECHAT_DEFAULTS: DeChatConfig = {
  platform: {
    kind: 'node',
  },
  network: {
    listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
    bootstrapPeers: [],
    maxConnections: 150,
    minConnections: 8,
    maxIncomingPendingConnections: 20,
  },
  peerAuthenticator: {
    authProtocol: '/deChat/core/auth/1.0.0',
    networkId: 'deChat-core-net-v1',
    maxCount: 5000,
    replayCacheWindowMs: 60_000,
  },
  pexService: {
    pexProtocol: '/deChat/core/peer-exchange-protocol/1.0.0',
    pexTopic: '/deChat/core/peer-exchange-topic/1.0.0',
    maxSharedPeers: 32,
    maxMsgsPerMin: 12,
    gossipIntervalMs: 30_000,
    pexRequestCooldownMs: 15_000,
    peerScoreDecayIntervalMs: 120_000,
    seenPeersBloomFilterTTLMs: 24 * 60 * 60_000, // 24 hrs
  },
  peerRegistry: {
    maxSize: 50_000,
    pexRequestCooldownMs: 15_000,
    peerEntryTtlMs: 30 * 60_000, // 30 mins
  },
  scoring: {
    minScore: -10,
    maxScore: 100,
    decayFactor: 0.98,
    minDialableScore: -2,
    decayIntervalMs: 120_000,
  },
  discovery: {
    enableMdns: true,
    onBoardingPeerTime: random(1, 10) * 1000 + random(1, 10) * 100,
  },
  dialQueue: {
    maxQueueLength: 256,
    minConnections: 8,
    maxConnections: 50,
    intervalMs: 10_000,
    buffer: 5,
  },
  strategies: {
    synchronizer: {
      protocol: '/deChat/v1/anti-entropy/1.0.0',
      syncIntervalMs: 60_000,
      retry: {
        maxRetries: 3,
        baseBackoffMs: 1_000,
        maxBackoffMs: 10_000,
      },
      adaptive: {
        enabled: false,
        scheduler: 'heuristic',
        minIntervalMs: 15_000,
        maxIntervalMs: 300_000,
        jitterMs: 5_000,
        idleSkipStreak: 3,
        idleActivityThreshold: 0.05,
        convergenceWindowSize: 20,
        minPeerWeight: 0.1,
        peerConvergence: {
          alpha: 0.15,
          beta: 0.05,
          gamma: 0.1,
          idleDecayMs: 30 * 60_000,
          neutralScore: 0.5,
        },
        bandit: {
          epsilon: 0.2,
          epsilonDecayPerAttempts: 0,
          epsilonFloor: 0.05,
        },
      },
    },
    propagation: {
      direct: {
        maxMessageBytes: 256 * 1024,
      },
      broadcast: {
        maxSeenMsgsPerTopic: 10_000,
        msgsTtlMin: 10 * 60 * 1000,
        maxMsgBytes: 64 * 1024,
      },
    },
    replication: {
      kReplicaCount: 3,
      maxAttempts: 3,
      baseDelayMs: 200,
      topic: '/deChat/v1/topic/replication-protocol',
      protocol: '/deChat/v1/protocol/replication-protocol',
    },
    store: {
      type: 'IN_MEMORY',
      dbPath: './levelDB',
    },
  },
  metrics: {
    enabled: false,
  },
  serialization: {
    wireFormat: 'cbor',
  },
};

/**
 * Add any new configuration constraints to this array.
 * The system automatically enforces them.
 */
const hasTcpListenAddr = (addrs: readonly string[]): boolean =>
  addrs.some((addr) => addr.includes('/tcp/') && !addr.includes('/ws'));

const configRules: ValidationRule[] = [
  {
    name: 'SyncPexCooldowns',
    validate: (config) => config.peerRegistry.pexRequestCooldownMs === config.pexService.pexRequestCooldownMs,
    message: (config) =>
      `Configuration mismatch: peerRegistry.pexRequestCooldownMs (${config.peerRegistry.pexRequestCooldownMs}) ` +
      `must exactly match pexService.pexRequestCooldownMs (${config.pexService.pexRequestCooldownMs}).`,
  },
  {
    name: 'ValidListenAddrs',
    validate: (config) => {
      if (config.platform.kind === 'browser') return Array.isArray(config.network.listenAddrs);
      return Array.isArray(config.network.listenAddrs) && config.network.listenAddrs.length > 0;
    },
    message: 'network.listenAddrs cannot be empty on Node. You must provide at least one listening address.',
  },
  {
    name: 'ValidConnectionLimits',
    validate: (config) => config.network.maxConnections > config.network.minConnections,
    message: 'maxConnections must be strictly greater than minConnections.',
  },
  {
    name: 'BrowserRequiresBootstrap',
    validate: (config) =>
      config.platform.kind !== 'browser' ||
      (Array.isArray(config.network.bootstrapPeers) && config.network.bootstrapPeers.length > 0),
    message: 'Browser platform requires at least one network.bootstrapPeers multiaddr.',
  },
  {
    name: 'BrowserDisallowsMdns',
    validate: (config) => config.platform.kind !== 'browser' || config.discovery.enableMdns === false,
    message: 'Browser platform forbids discovery.enableMdns (mDNS is Node LAN only).',
  },
  {
    name: 'BrowserDisallowsTcpListen',
    validate: (config) => config.platform.kind !== 'browser' || !hasTcpListenAddr(config.network.listenAddrs),
    message: 'Browser platform rejects TCP listen multiaddrs — use dial-only or WebSocket-capable addrs.',
  },
  {
    name: 'BrowserDisallowsLevelDb',
    validate: (config) => config.platform.kind !== 'browser' || config.strategies.store.type !== 'LEVEL_DB',
    message: 'LEVEL_DB store is Node-only. Use IN_MEMORY or INDEXED_DB on browser.',
  },
];

/**
 * Validates the resolved configuration against all defined rules.
 * Outputs a boolean indicating if the config is structurally and logically sound.
 */
export const isConfigValid = (config: DeChatConfig): boolean => {
  let isValid = true;

  for (const rule of configRules) {
    if (!rule.validate(config)) {
      isValid = false;
      const errorMessage = typeof rule.message === 'function' ? rule.message(config) : rule.message;

      // Highly recommended to replace console.error with your logger
      console.error(`[Config Validation Failed] Rule '${rule.name}': ${errorMessage}`);
    }
  }

  return isValid;
};

/**
 * Deep merge user overrides with defaults, apply platform profile defaults, and validate.
 */
export const resolveConfig = (userOpts?: PartialDeep<DeChatConfig>): DeChatConfig => {
  const resolved = userOpts ? merge(structuredClone(DECHAT_DEFAULTS), userOpts) : structuredClone(DECHAT_DEFAULTS);

  if (resolved.platform.kind === 'browser') {
    resolved.discovery.enableMdns = false;
    // es-toolkit/lodash-style merge does not replace arrays with `[]` — force dial-only default.
    resolved.network.listenAddrs =
      userOpts?.network?.listenAddrs !== undefined ? [...userOpts.network.listenAddrs] : [];
  }

  if (!isConfigValid(resolved)) {
    throw new Error('Invalid DeChat node configuration provided. Please fix the validation errors above.');
  }

  return resolved;
};
