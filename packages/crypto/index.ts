/**
 * Portable `@dechat/crypto` entry — safe for browser and Node.
 * Node-only PEM / filesystem helpers live under `@dechat/crypto/node`.
 */
export { base64UrlToBytes, bytesToBase64Url, toBytes, utf8ToBytes } from './src/bytes';
export {
  calculateXorDistance,
  genEd25519KeyPair,
  generateIdProtocolPrefix,
  generateRandomUUID,
  type HashInput,
  sha1Hex,
  sha256,
  toHashBigInt,
} from './src/utils';
