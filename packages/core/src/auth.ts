import { logger } from '@dechat/common';
import { sha256 } from '@dechat/crypto';
import { Libp2p, PeerId } from '@libp2p/interface';
import * as ed from '@noble/ed25519';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { PeerExchangeService } from './PeerExchangeService';
import { now, readFromStream, writeToStream } from './utils';

type AuthSignMessage = {
  pub: string; // base64url of public key (32 bytes)
  sig: string; // base64url of signature
  timestamp: number;
  nonce: string;
};

type AuthSignResponse = {
  isVerified: boolean;
};

const AUTH_PROTOCOL = '/deChat/auth/1.0.0';
const NETWORK_ID = 'deChat-net-v1';

/**
 * Generate a new keypair (private 32 bytes, public 32 bytes)
 */
export const genEd25519KeyPair = async (plainSeed?: string): Promise<{ secret: Uint8Array; pub: Uint8Array }> => {
  let secret = ed.utils.randomSecretKey();
  if (plainSeed) {
    const msgBytes = new TextEncoder().encode(plainSeed);
    const secretHash64Bytes = createHash('sha512').update(msgBytes).digest();
    secret = ed.utils.randomSecretKey(secretHash64Bytes.subarray(0, 32)); // Uint8Array(32)
  }
  const pub = await ed.getPublicKeyAsync(secret); // Uint8Array(32)
  return { secret: new Uint8Array(secret), pub: new Uint8Array(pub) };
};

const hash = (input: string): string => sha256(input);

const generateNonce = (myPeerId: string, remotePeerId: string, timestamp: number, randomNonce: string): string => {
  const peerNonce = myPeerId < remotePeerId ? `${myPeerId}|${remotePeerId}` : `${remotePeerId}|${myPeerId}`;
  return `${NETWORK_ID}|${peerNonce}|${timestamp}|${randomNonce}`;
};

/**
 * registers AUTH_PROTOCOL handler
 * @param node
 * @param opts
 */
export const installAuthServer = (
  node: Libp2p,
  opts: { replayCacheWindowMs?: number; pex: PeerExchangeService },
): void => {
  const { pex } = opts;
  const replayCacheWindowMs = opts.replayCacheWindowMs ?? 60_000;

  const nonceCache = new LRUCache<string, number>({
    max: 50000, // Limit entries
    ttl: replayCacheWindowMs,
  });

  node.handle(AUTH_PROTOCOL, async ({ stream, connection }) => {
    try {
      const myPeerId = node.peerId.toString();
      const remotePeerId = connection.remotePeer.toString();
      const timestamp = now();

      const authResponse = (await readFromStream(stream)) as AuthSignMessage;

      if (
        !authResponse ||
        !authResponse.pub ||
        !authResponse.sig ||
        !authResponse.nonce ||
        !authResponse.timestamp ||
        Math.abs(timestamp - authResponse.timestamp) > 60_000 ||
        nonceCache.has(authResponse.nonce)
      ) {
        await stream.close();
        return;
      }

      nonceCache.set(authResponse.nonce, timestamp);

      const contextStr = generateNonce(myPeerId, remotePeerId, authResponse.timestamp, authResponse.nonce);

      const hashed = hash(contextStr);
      const message = uint8ArrayFromString(hashed);
      const pub = Buffer.from(authResponse.pub, 'base64url');
      const sig = Buffer.from(authResponse.sig, 'base64url');

      const isVerified = await ed.verifyAsync(sig, message, pub);

      if (!isVerified) {
        await stream.close();
        return;
      }

      logger.info('Authentication handled succesfully with peer: ', remotePeerId);
      pex.addPeers([{ peerId: remotePeerId, addresses: [connection.remoteAddr.toString()] }]);
      pex.initiatePeerExchange();

      await writeToStream(stream, { isVerified } as AuthSignResponse);
    } catch {
      logger.warn('Authentication failed with Peer: ', connection.remotePeer.toString(), ' severing connection');
      try {
        await stream.close();
        await node.hangUp(connection.remotePeer);
      } catch {}
    }
  });
};

/**
 *
 * @param node
 * @param targetPeerId
 * @param myPrivKey
 * @returns true if server responded OK (and thus peer verified) otherwise false
 */
export const runAuthClient = async (node: Libp2p, targetPeerId: PeerId, myPrivKey: Uint8Array): Promise<boolean> => {
  const timestamp = now();
  const nonce = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);

  const contextStr = generateNonce(node.peerId.toString(), targetPeerId.toString(), timestamp, nonce);
  const hashed = hash(contextStr);
  const message = uint8ArrayFromString(hashed);
  const sig = await ed.signAsync(message, myPrivKey);
  const pub = await ed.getPublicKeyAsync(myPrivKey);

  const authMessage: AuthSignMessage = {
    pub: Buffer.from(pub).toString('base64url'),
    sig: Buffer.from(sig).toString('base64url'),
    timestamp,
    nonce,
  };

  const stream = await node.dialProtocol(targetPeerId, AUTH_PROTOCOL);

  await writeToStream(stream, authMessage);

  const response = (await readFromStream(stream)) as AuthSignResponse;

  return !!response.isVerified;
};
