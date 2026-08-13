import { publicKeyFromRaw } from '@libp2p/crypto/keys';
import { PeerId } from '@libp2p/interface';
import { peerIdFromPublicKey } from '@libp2p/peer-id';

/**
 * Derives the libp2p PeerId that must match a raw 32-byte Ed25519 public key.
 * Used to bind an auth handshake pubkey to `connection.remotePeer`.
 */
export const peerIdFromEd25519PublicKeyBytes = (pub: Uint8Array): PeerId => peerIdFromPublicKey(publicKeyFromRaw(pub));
