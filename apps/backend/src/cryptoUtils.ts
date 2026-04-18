import crypto, { KeyObject } from 'crypto';
import ky from 'ky';

interface ChallengeResponse {
  response: string;
  publicKey: string;
}

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
    const response = (await ky(`${nodeAddress}/challenge`, {
      method: 'post',
      json: {
        challenge,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      },
    }).then((r) => r.json())) as ChallengeResponse;

    // Verify the challenge response
    const isValid = verifySignature(challenge, response.response, response.publicKey);
    if (isValid) {
      console.log(`Verified node: ${nodeAddress}`);
      return { isValid: true, publicKey: response.publicKey };
    } else {
      console.error(`Invalid response from node: ${nodeAddress}`);
      return { isValid: false, publicKey: '' };
    }
  } catch (error: unknown) {
    console.error(`Failed to verify node: ${nodeAddress} - ${error}`);
    return { isValid: false, publicKey: '' };
  }
};
