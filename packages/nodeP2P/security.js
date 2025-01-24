import crypto from 'crypto';
import fs from 'fs';

// AES Encryption
export const encryptMessage = (message, aesKey, aesIV = crypto.randomBytes(16)) => {
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesIV);
  const encrypted = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
  return `${aesIV.toString('hex')}|${encrypted.toString('hex')}`;
};

export const decryptMessage = (encryptedMessage, aesKey) => {
  const [ivHex, encryptedHex] = encryptedMessage.split('|');
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};

// HMAC Authentication
export const generateHMAC = (message, secretKey) => {
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
};

// TLS Certificate and Key
export const getTLSCredentials = (certPath, keyPath) => ({
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
});
