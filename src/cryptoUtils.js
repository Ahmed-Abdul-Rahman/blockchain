import crypto from 'crypto';

export const encryptMessage = (message, nodePublicKey) => {
  return crypto.publicEncrypt(nodePublicKey, Buffer.from(message)).toString('base64');
};

export const decryptMessage = (encryptedMessage, privateKey) => {
  return crypto.privateDecrypt(privateKey, Buffer.from(encryptedMessage, 'base64')).toString();
};

export const verifySignature = (message, signature, nodePublicKey) => {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(message),
      crypto.createPublicKey(nodePublicKey),
      Buffer.from(signature, 'base64'),
    );
  } catch (err) {
    console.log(err);
    return false;
  }
};

export const signMessage = (message, privateKey) => {
  return crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64');
};
