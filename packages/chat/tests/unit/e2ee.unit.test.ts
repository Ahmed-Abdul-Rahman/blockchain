import { peerIdFromEd25519PublicKeyBytes } from '@dechat/core';
import { genEd25519KeyPair, generateAes256Key } from '@dechat/crypto';
import { describe, expect, it } from 'vitest';
import { decryptChatBody, encryptChatBody } from '../../src/e2ee/encryptChatBody';
import { RoomKeyRing } from '../../src/e2ee/RoomKeyRing';

describe('encryptChatBody', () => {
  it('round-trips a body and keeps plaintext out of the envelope', async () => {
    const { secret, pub } = await genEd25519KeyPair('e2ee-envelope');
    const senderPeerId = peerIdFromEd25519PublicKeyBytes(pub).toString();
    const roomKey = generateAes256Key();

    const envelope = await encryptChatBody({
      roomId: 'lobby',
      messageId: 'm1',
      senderPeerId,
      senderPublicKey: pub,
      senderSecret: secret,
      timestamp: 1,
      keyEpoch: 1,
      roomKey,
      body: { text: 'hello-secret' },
      displayName: 'alice',
    });

    expect(JSON.stringify(envelope)).not.toContain('hello-secret');
    expect(JSON.stringify(envelope)).not.toContain('alice');

    const plain = await decryptChatBody(envelope, roomKey);
    expect(plain?.body.text).toBe('hello-secret');
    expect(plain?.displayName).toBe('alice');
  });

  it('rejects a tampered ciphertext and a wrong room key', async () => {
    const { secret, pub } = await genEd25519KeyPair('e2ee-tamper');
    const senderPeerId = peerIdFromEd25519PublicKeyBytes(pub).toString();
    const roomKey = generateAes256Key();
    const envelope = await encryptChatBody({
      roomId: 'lobby',
      messageId: 'm1',
      senderPeerId,
      senderPublicKey: pub,
      senderSecret: secret,
      timestamp: 1,
      keyEpoch: 1,
      roomKey,
      body: { text: 'hello-secret' },
    });

    expect(await decryptChatBody({ ...envelope, ciphertext: `${envelope.ciphertext}aa` }, roomKey)).toBeUndefined();
    expect(await decryptChatBody(envelope, generateAes256Key())).toBeUndefined();
  });
});

describe('RoomKeyRing', () => {
  it('creates, rotates, decrypts old epochs, and discards on leave', () => {
    const ring = new RoomKeyRing();
    const first = ring.create('lobby');
    expect(first.epoch).toBe(1);
    expect(ring.current('lobby')?.epoch).toBe(1);

    const second = ring.rotate('lobby');
    expect(second.epoch).toBe(2);
    expect(ring.get('lobby', 1)).toEqual(first.key);
    expect(ring.current('lobby')?.key).toEqual(second.key);

    ring.discard('lobby');
    expect(ring.current('lobby')).toBeUndefined();
  });

  it('adopts a remote key and ignores a conflicting key at the same epoch', () => {
    const ring = new RoomKeyRing();
    const keyA = generateAes256Key();
    const keyB = generateAes256Key();
    ring.adopt('lobby', 1, keyA);
    ring.adopt('lobby', 1, keyB);
    expect(ring.get('lobby', 1)).toEqual(keyA);
    ring.adopt('lobby', 2, keyB);
    expect(ring.current('lobby')?.epoch).toBe(2);
  });
});
