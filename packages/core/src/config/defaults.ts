import { merge, random } from 'es-toolkit';
import { DeChatConfig } from './types';

export const DECHAT_DEFAULTS: DeChatConfig = {
  network: {
    listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
    bootstrapPeers: [],
    maxConnections: 150,
    minConnections: 8,
    maxIncomingPendingConnections: 20,
  },
  pexService: {
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
    nodeKey: { secret: new Uint8Array(), pub: new Uint8Array() },
  },
  dialQueue: {
    maxQueueLength: 256,
    minConnections: 8,
    maxConnections: 50,
    intervalMs: 10_000,
    buffer: 5,
  },
  metrics: {
    enabled: false,
  },
};

// Deep merge user overrides with defaults
export const resolveConfig = (userOpts?: Partial<DeChatConfig>): DeChatConfig => {
  return userOpts ? merge(DECHAT_DEFAULTS, userOpts) : DECHAT_DEFAULTS;
};
