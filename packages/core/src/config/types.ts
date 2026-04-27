export interface DeChatConfig {
  network: {
    listenAddrs: string[];
    bootstrapPeers: string[];
    maxConnections: number;
    minConnections: number;
    maxIncomingPendingConnections: number;
  };
  pexService: {
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

    /** Minimum score for a peer to be eligible for dailing */
    minDialableScore: number;

    decayIntervalMs: number;
  };
  discovery: {
    enableMdns: boolean;

    /** Time to wait before onboarding the peer to the network */
    onBoardingPeerTime: number;

    nodeKey?: { secret: Uint8Array; pub: Uint8Array };
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
    };
    store: {
      /** Replica Storage type */
      type: 'IN_MEMORY' | 'LEVEL_DB';
      /** DB Path to store data in file - for levelDB */
      dbPath: string;
    };
  };
  metrics: {
    enabled: boolean;
  };
}
