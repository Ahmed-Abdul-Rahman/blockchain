export type PeerInfoLite = { peerId: string; addresses: string[] };

export type GET_PEERS_MSG = { type: 'GET_PEERS'; want?: number };
export type PEX_PEER_LIST = { type: 'PEER_LIST'; peers: PeerInfoLite[] };
export type PEX_GOSSIP = {
  /** PeerId of the origin peer */
  from: string;
  /** message type */
  type: 'PEX_GOSSIP';
  /** All the availabile peers connected to */
  peers: PeerInfoLite[];
  /** timestamp */
  ts: number;
  /** orging peer details */
  originPeerInfo: PeerInfoLite;
};

export type scorer = {
  reward: (peerId: string, amount?: number) => void;
  penalize: (peerId: string, amount?: number) => void;
  isDialable: (peerId: string) => boolean;
};

export type AuthSignMessage = {
  /** base64url of public key (32 bytes) */
  pub: string;
  /** base64url of signature */
  sig: string;
  timestamp: number;
  /** a random nonce */
  nonce: string;
};

export type AuthSignResponse = {
  isVerified: boolean;
};

export interface ShouldDialOptions {
  /** Our own peer ID (string form, e.g. base58) */
  selfPeerId: string;

  /** The peer we just discovered */
  discoveredPeerId: string;

  /** Whether this node is "new" (true = recently joined) */
  isNewPeer: boolean;

  /** How many peers should a new peer dial? */
  maxOutbound?: number;

  /** Backoff probability for existing peers */
  electionModulo?: number;
}

export type NodeKey = {
  secret: Uint8Array<ArrayBufferLike>;
  pub: Uint8Array;
};
