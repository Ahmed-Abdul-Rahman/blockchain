import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { describe, expect, it } from 'vitest';
import { peerIdFromEd25519PublicKeyBytes } from '../../../src/networking/peerIdFromEd25519PublicKeyBytes';

describe('peerIdFromEd25519PublicKeyBytes', () => {
  it('derives the same PeerId libp2p uses for the matching private key', async () => {
    const privateKey = await generateKeyPairFromSeed('Ed25519', crypto.getRandomValues(new Uint8Array(32)));
    const fromPrivate = peerIdFromPrivateKey(privateKey);
    const fromPublic = peerIdFromEd25519PublicKeyBytes(privateKey.publicKey.raw);

    expect(fromPublic.toString()).toBe(fromPrivate.toString());
  });
});
