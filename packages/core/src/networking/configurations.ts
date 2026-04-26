/** Maximum peers to be shared with another peer on PEX_TOPIC and PEX_PROTOCOL */
export const MAX_SHARED_PEERS = 32;

/** Maximum messages to be received from peers per minute on gossip, if it crosses this limit, the peer will be penalized by scorer */
export const MAX_PEX_MSGS_PER_MIN = 12;

/** Gossip available peers with others at every GOSSIP_INTERVAL_MS */
export const GOSSIP_INTERVAL_MS = 30_000;

/** A peer can request data only if this cooldown period is completed */
export const PEX_REQUEST_COOLDOWN_MS = 15_000;

/** Only Peers interacting within this time limit remain in the Peer Registry */
export const PEER_ENTRY_TTL_MS = 30 * 60_000;

/** Decay/Decrease the score of peer at every PEER_SCORE_DECAY_INTERVAL ms,
 *  this value should always be a minute greater than the @constant GOSSIP_INTERVAL_MS*/
export const PEER_SCORE_DECAY_INTERVAL = 120_000;

/** * Bloom filter for seen peers should be reset periodically to allow re-dialing
 * of peers that might have churned or changed addresses.
 */
export const SEEN_PEERS_BLOOM_FILTER_TTL_MS = 24 * 60 * 60_000; // 24 hours
