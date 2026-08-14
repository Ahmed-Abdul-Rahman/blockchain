import * as ed from '@noble/ed25519';

export const signEd25519 = async (message: Uint8Array, secret: Uint8Array): Promise<Uint8Array> =>
  ed.signAsync(message, secret);

export const verifyEd25519 = async (
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> => {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
};
