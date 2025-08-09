import crypto, { KeyObject } from 'crypto';

import fs from 'fs';
import axios from 'axios';
import { Envelope } from './types';

export const signPayload = (privateKey: KeyObject, payloadString: string): string => {
  // For ed25519 you pass null as algorithm param in crypto.sign
  return crypto.sign(null, Buffer.from(payloadString), privateKey).toString('base64');
};

export const verifyEnvelope = (envelope: Envelope): boolean => {
  try {
    const pubKey = crypto.createPublicKey({ key: envelope.pubKey, format: 'pem', type: 'spki' });
    return crypto.verify(
      null,
      Buffer.from(JSON.stringify(envelope.payload)),
      pubKey,
      Buffer.from(envelope.signature, 'base64'),
    );
  } catch (e: unknown) {
    console.log('Error occured while verifying envelope: ', e);
    return false;
  }
};

export const encryptMessage = (message: string, nodePublicKey: KeyObject): string => {
  return crypto.publicEncrypt(nodePublicKey, Buffer.from(message)).toString('base64');
};

export const decryptMessage = (encryptedMessage: string, privateKey: KeyObject): string => {
  return crypto.privateDecrypt(privateKey, Buffer.from(encryptedMessage, 'base64')).toString();
};

export const verifySignature = (message: string, signature: string, nodePublicKey: string): boolean => {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(message),
      crypto.createPublicKey(Buffer.from(nodePublicKey)),
      Buffer.from(signature, 'base64'),
    );
  } catch (err) {
    console.log(err);
    return false;
  }
};

export const signMessage = (message: string, privateKey: KeyObject): string => {
  return crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64');
};

export const initiateChallenge = async (
  nodeAddress: string,
  publicKey: KeyObject,
): Promise<{ isValid: boolean; publicKey: string }> => {
  const challenge = crypto.randomBytes(32).toString('hex');
  try {
    const response = await axios.post(`${nodeAddress}/challenge`, {
      challenge,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    });

    // Verify the challenge response
    const isValid = verifySignature(challenge, response.data.response, response.data.publicKey);
    if (isValid) {
      console.log(`Verified node: ${nodeAddress}`);
      return { isValid: true, publicKey: response.data.publicKey };
    } else {
      console.error(`Invalid response from node: ${nodeAddress}`);
      return { isValid: false, publicKey: '' };
    }
  } catch (error: unknown) {
    console.error(`Failed to verify node: ${nodeAddress} - ${error}`);
    return { isValid: false, publicKey: '' };
  }
};

export const loadOrGenerateKeypair = (
  keyFilePath: string,
  isLocalTest: boolean = false,
): { privateKey: KeyObject; publicKey: KeyObject; pem: string } => {
  if (fs.existsSync(keyFilePath) && !isLocalTest) {
    const pem = fs.readFileSync(keyFilePath, 'utf8');
    const privateKey = crypto.createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' });
    const publicKey = crypto.createPublicKey(privateKey);
    return { privateKey, publicKey, pem };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  if (!isLocalTest) fs.writeFileSync(keyFilePath, privatePem, { mode: 0o600 });
  return { privateKey, publicKey, pem: privatePem };
};
