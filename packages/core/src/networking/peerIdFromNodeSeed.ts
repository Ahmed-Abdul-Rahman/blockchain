import { genEd25519KeyPair } from '@dechat/crypto';
import { peerIdFromEd25519PublicKeyBytes } from './peerIdFromEd25519PublicKeyBytes';

/**
 * Derives the libp2p PeerId string that {@link createDeChatNode} will use for `nodeSeed`.
 * Lets callers preview identity without starting a node.
 */
export const peerIdFromNodeSeed = async (nodeSeed: string): Promise<string> => {
  const { pub } = await genEd25519KeyPair(nodeSeed);
  return peerIdFromEd25519PublicKeyBytes(pub).toString();
};
