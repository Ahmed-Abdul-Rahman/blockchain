import { merge, random } from 'es-toolkit';
import { PartialDeep } from 'type-fest';
import { DeChatConfig, ValidationRule } from './types';

export const DECHAT_DEFAULTS: DeChatConfig = {
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
};

/**
 * Add any new configuration constraints to this array.
 * The system automatically enforces them.
 */
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
    validate: (config) => Array.isArray(config.network.listenAddrs) && config.network.listenAddrs.length > 0,
    message: 'network.listenAddrs cannot be empty. You must provide at least one listening address.',
  },
  {
    name: 'ValidConnectionLimits',
    validate: (config) => config.network.maxConnections > config.network.minConnections,
    message: 'maxConnections must be strictly greater than minConnections.',
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
 * Deep merge user overrides with defaults, and validate the final result.
 */
export const resolveConfig = (userOpts?: PartialDeep<DeChatConfig>): DeChatConfig => {
  const resolved = userOpts ? merge(DECHAT_DEFAULTS, userOpts) : DECHAT_DEFAULTS;

  if (!isConfigValid(resolved)) {
    throw new Error('Invalid DeChat node configuration provided. Please fix the validation errors above.');
  }

  return resolved;
};
