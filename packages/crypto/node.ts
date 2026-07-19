/**
 * Node-only `@dechat/crypto` entry — includes PEM/filesystem signature helpers.
 * Prefer the portable root export (`@dechat/crypto`) for digests / Ed25519 seeds.
 */
export * from './index';
export { loadOrGenerateKeypair } from './src/signatureVerification';
