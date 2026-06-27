export interface DeChatConfig {
  network: {
    /** A list of string multiaddrs to listen on */
    listenAddrs: string[];

    /** Override bootstrap multiaddrs*/
    bootstrapPeers: string[];

    /** The maximum number of connections libp2p is willing to have before it starts pruning connections to reduce resource usage. Also used by DialQueue to maintain maximum peer connections */
    maxConnections: number;

    /** The minium number of connections Peer needs to maintain. Only used by DialQueue */
    minConnections: number;

    /**The maximum number of parallel incoming connections allowed that have yet to complete the connection upgrade - e.g. choosing connection encryption, muxer, etc. */
    maxIncomingPendingConnections: number;
  };
  peerAuthenticator: {
    /** Auth Protocol used for authenticating newly discovered peers */
    authProtocol: string;

    /** Unique network id for authentication */
    networkId: string;

    /**The maximum number of items to store in the cache before evicting old entries */
    maxCount: number;

    /** Replay Time in milliseconds for items to live in cache before they are considered stale. */
    replayCacheWindowMs: number;

    nodeKey?: { secret: Uint8Array; pub: Uint8Array };
  };
  pexService: {
    /** Peer Exchange Handle Protocol used to request connected peers from other peers*/
    pexProtocol: string;

    /** Peer Exchange Gossip Protocol Topic used to exchange peers on the connected network*/
    pexTopic: string;

    /** Maximum peers to be shared with another peer on PEX_TOPIC and PEX_PROTOCOL */
    maxSharedPeers: number;

    /** Maximum messages to be received from peers per minute on gossip, if it crosses this limit, the peer will be penalized by scorer */
    maxMsgsPerMin: number;

    /** Gossip available peers with others at every gossipIntervalMs */
    gossipIntervalMs: number;

    /** A peer can request data only if this cooldown period is completed */
    pexRequestCooldownMs: number;

    /** Decay/Decrease the score of peer at every PEER_SCORE_DECAY_INTERVAL ms,
     *  this value should always be a minute greater than the @property gossipIntervalMs*/
    peerScoreDecayIntervalMs: number;

    /** * Bloom filter for seen peers should be reset periodically to allow re-dialing
     * of peers that might have churned or changed addresses.
     */
    seenPeersBloomFilterTTLMs: number;
  };
  peerRegistry: {
    /** Maximum peers that can be stored */
    maxSize: number;

    /** A peer can request data only if this cooldown period is completed should be same as @property pexService.pexRequestCooldownMs*/
    pexRequestCooldownMs: DeChatConfig['pexService']['pexRequestCooldownMs'];

    /** Only Peers interacting within this time limit remain in the Peer Registry */
    peerEntryTtlMs: number;
  };
  scoring: {
    /** Minimum score a peer can be penalized with */
    minScore: number;

    /** Maximum score a peer can we rewarded */
    maxScore: number;

    /** Periodically applies this decay factor to the peers score */
    decayFactor: number;

    /** Minimum score for a peer to be eligible for dail */
    minDialableScore: number;

    decayIntervalMs: number;
  };
  discovery: {
    /** Enable Multicast DNS */
    enableMdns: boolean;

    /** Time to wait before interacting with a newly discovered peer and on board it to the network, used as the debounce delay when peer is bursted with new peer discovery events */
    onBoardingPeerTime: number;
  };
  dialQueue: {
    /** Maximum peers that can be enqueued in the dial queue */
    maxQueueLength: number;

    /** Maximum number of active connections that a peer can have with other peers */
    maxConnections: number;

    /** Minimum number of active connections with the peer to be maintained */
    minConnections: number;

    /** At this interval ms the dial queue is processed */
    intervalMs: number;

    /** Buffer number used to calculate the number of target connections to be acheived and maintained*/
    buffer: number;
  };
  strategies: {
    synchronizer: {
      /** Data convergence Protocol used for anti-entropy data sync across peers*/
      protocol: string;

      /** Interval number to run the AntiEntropy Synchronizer periodically to stabilize the network with consistent data across peers */
      syncIntervalMs: number;

      /** Bounded retry policy applied when a sync ends in a partial (incomplete) outcome */
      retry: {
        /** Maximum number of retry attempts against the same peer after a partial sync (0 disables retries) */
        maxRetries: number;

        /** Base backoff delay in ms; grows exponentially per attempt (base * 2^attempt) */
        baseBackoffMs: number;

        /** Upper bound for a single backoff delay in ms (before jitter) */
        maxBackoffMs: number;
      };
    };
    propagation: {
      direct: {
        /** Maximum message length that can be read */
        maxMessageBytes: number;
      };
      broadcast: {
        /** Maximum seen messages a topic can have */
        maxSeenMsgsPerTopic: number;

        /** Messages Time to live in minutes */
        msgsTtlMin: number;

        /** Maximum message bytes allowed for a message */
        maxMsgBytes: number;
      };
    };
    replication: {
      /** The number of peers that can hold a replicated data */
      kReplicaCount: number;

      /** Max number of attempts to retry and send the replica_request */
      maxAttempts: number;

      /** Base delay used for exponential backoff retry policy */
      baseDelayMs: number;

      /** Broadcast propagation topic */
      topic: string;

      /** Direct propagation protocol */
      protocol: string;
    };
    store: {
      /** Replica Storage type */
      type: 'IN_MEMORY' | 'LEVEL_DB';
      /** DB Path to store data in file - for levelDB */
      dbPath: string;
    };
  };
  metrics: {
    /** Enable metrics for node behaviour analysis */
    enabled: boolean;
  };
}

export type ValidationRule = {
  name: string;
  validate: (config: DeChatConfig) => boolean;
  message: string | ((config: DeChatConfig) => string);
};
