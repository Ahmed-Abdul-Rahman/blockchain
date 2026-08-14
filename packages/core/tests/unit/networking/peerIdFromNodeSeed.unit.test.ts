import { genEd25519KeyPair } from '@dechat/crypto';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { describe, expect, it } from 'vitest';
import { peerIdFromNodeSeed } from '../../../src/networking/peerIdFromNodeSeed';

describe('peerIdFromNodeSeed', () => {
  it('derives the same PeerId createDeChatNode would from that seed', async () => {
    const seed = 'identity-seed-v1';
    const { secret } = await genEd25519KeyPair(seed);
    const fromPrivate = peerIdFromPrivateKey(await generateKeyPairFromSeed('Ed25519', secret));

    expect(await peerIdFromNodeSeed(seed)).toBe(fromPrivate.toString());
  });

  it('is stable for the same seed and distinct across seeds', async () => {
    const a = await peerIdFromNodeSeed('alice-seed');
    const again = await peerIdFromNodeSeed('alice-seed');
    const b = await peerIdFromNodeSeed('bob-seed');

    expect(again).toBe(a);
    expect(b).not.toBe(a);
  });
});
