import { describe, expect, it } from 'vitest';
import { genEd25519KeyPair, utf8ToBytes } from '../../index';
import { aesGcmDecrypt, aesGcmEncrypt, generateAes256Key } from '../../src/aesGcm';
import { signEd25519, verifyEd25519 } from '../../src/ed25519Sign';

describe('aesGcm', () => {
  it('round-trips plaintext and fails with the wrong key', async () => {
    const key = generateAes256Key();
    const { nonce, ciphertext } = await aesGcmEncrypt(key, utf8ToBytes('secret-body'));
    const plain = await aesGcmDecrypt(key, nonce, ciphertext);
    expect(new TextDecoder().decode(plain)).toBe('secret-body');

    await expect(aesGcmDecrypt(generateAes256Key(), nonce, ciphertext)).rejects.toThrow();
  });

  it('encrypts a sliced Uint8Array view without using the backing buffer wholesale', async () => {
    const key = generateAes256Key();
    const padded = new Uint8Array([0, ...utf8ToBytes('secret-body'), 0]);
    const view = padded.subarray(1, padded.length - 1);
    const { nonce, ciphertext } = await aesGcmEncrypt(key, view);
    const plain = await aesGcmDecrypt(key, nonce, ciphertext);
    expect(new TextDecoder().decode(plain)).toBe('secret-body');
  });
});

describe('ed25519Sign', () => {
  it('verifies a signature and rejects a tampered message', async () => {
    const { secret, pub } = await genEd25519KeyPair('sign-seed');
    const message = utf8ToBytes('bind-this');
    const signature = await signEd25519(message, secret);

    expect(await verifyEd25519(signature, message, pub)).toBe(true);
    expect(await verifyEd25519(signature, utf8ToBytes('tampered'), pub)).toBe(false);
  });
});
