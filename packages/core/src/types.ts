export type PeerInfoLite = { peerId: string; addresses: string[] };

export type GET_PEERS_MSG = { type: 'GET_PEERS'; want?: number };
export type PEX_PEER_LIST = { type: 'PEER_LIST'; peers: PeerInfoLite[] };
export type PEX_GOSSIP = {
  from: string;
  type: 'PEX_GOSSIP';
  peers: PeerInfoLite[];
  ts: number;
  originPeerInfo: PeerInfoLite;
};

export type scorer = {
  reward: (peerId: string, amount?: number) => void;
  penalize: (peerId: string, amount?: number) => void;
  isDialable: (peerId: string) => boolean;
};

export type AuthMessage = {
  pub: string;
  sig: string;
  timestamp: number;
  nonce: string;
};

export type AuthResponse = {
  isVerified: boolean;
};
