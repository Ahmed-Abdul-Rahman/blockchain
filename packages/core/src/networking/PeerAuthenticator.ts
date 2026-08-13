import { logger } from '@dechat/common';
import { base64UrlToBytes, bytesToBase64Url, sha256 } from '@dechat/crypto';
import { IncomingStreamData, PeerId, Startable } from '@libp2p/interface';
import * as ed from '@noble/ed25519';
import { LRUCache } from 'lru-cache';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { AuthMetrics } from '../metrics/interfaces/AuthMetrics';
import { createFramedStreamCodec, FramedStreamCodec } from '../shared/serialization/framedStreamCodec';
import { DeChatComponents, DeChatFactory } from '../types';
import { peerIdFromEd25519PublicKeyBytes } from './peerIdFromEd25519PublicKeyBytes';
import { AuthSignMessage, AuthSignResponse } from './types';

export class PeerAuthenticator implements Startable {
  private node: DeChatComponents['libp2p'];

  private config: DeChatComponents['config']['peerAuthenticator'];

  private pexService: DeChatComponents['pexService'];

  private metrics: AuthMetrics;

  private nonceCache: LRUCache<string, number>;

  private readonly framedStream: FramedStreamCodec;

  constructor(components: DeChatComponents) {
    if (!components.config.peerAuthenticator.nodeKey) {
      throw new Error('PeerAuthenticator requires nodeKey');
    }

    this.config = components.config.peerAuthenticator;
    this.node = components.libp2p;
    this.pexService = components.pexService;
    this.metrics = components.metrics?.authMetrics;

    this.nonceCache = new LRUCache<string, number>({
      max: this.config.maxCount,
      ttl: this.config.replayCacheWindowMs,
    });
    this.framedStream = createFramedStreamCodec(components.serializer);
  }

  start(): void {
    this.node.handle(this.config.authProtocol, this.handleIncomingAuth.bind(this));
  }

  stop(): void {
    this.node.unhandle(this.config.authProtocol);
    this.nonceCache.clear();
  }

  generateNonce(myPeerId: string, remotePeerId: string, timestamp: number, randomNonce: string): string {
    const peerNonce = myPeerId < remotePeerId ? `${myPeerId}|${remotePeerId}` : `${remotePeerId}|${myPeerId}`;
    return `${this.config.networkId}|${peerNonce}|${timestamp}|${randomNonce}`;
  }

  private async handleIncomingAuth({ stream, connection }: IncomingStreamData): Promise<void> {
    try {
      const myPeerId = this.node.peerId.toString();
      const remotePeerId = connection.remotePeer.toString();
      const timestamp = Date.now();

      const authResponse = (await this.framedStream.readFromStream(stream)) as AuthSignMessage;

      if (
        !authResponse ||
        !authResponse.pub ||
        !authResponse.sig ||
        !authResponse.nonce ||
        !authResponse.timestamp ||
        Math.abs(timestamp - authResponse.timestamp) > 60_000 ||
        this.nonceCache.has(authResponse.nonce)
      ) {
        await stream.close();
        return;
      }

      this.nonceCache.set(authResponse.nonce, timestamp);
      const pub = base64UrlToBytes(authResponse.pub);
      let presentedPeerId: string;
      try {
        presentedPeerId = peerIdFromEd25519PublicKeyBytes(pub).toString();
      } catch {
        await stream.close();
        this.metrics.verificationFailed('invalid_public_key');
        return;
      }

      if (presentedPeerId !== remotePeerId) {
        await stream.close();
        this.metrics.verificationFailed('peer_id_mismatch');
        logger.warn('Authentication rejected: presented public key does not match remote PeerId', remotePeerId);
        return;
      }

      const contextStr = this.generateNonce(myPeerId, remotePeerId, authResponse.timestamp, authResponse.nonce);
      const hashed = sha256(contextStr);
      const message = uint8ArrayFromString(hashed);
      const sig = base64UrlToBytes(authResponse.sig);

      const isVerified = await ed.verifyAsync(sig, message, pub);

      if (!isVerified) {
        await stream.close();
        this.metrics.verificationFailed('invalid_signature');
        return;
      }

      logger.info('Authentication handled succesfully with peer: ', remotePeerId);
      this.pexService.addPeers([{ peerId: remotePeerId, addresses: [connection.remoteAddr.toString()] }]);
      this.pexService.initiatePeerExchange();

      await this.framedStream.writeToStream(stream, { isVerified } as AuthSignResponse);
      this.metrics.verificationSucceeded();
    } catch {
      logger.warn('Authentication failed with Peer: ', connection.remotePeer.toString(), ' severing connection');
      this.metrics.verificationFailed('unknown_peer');
      try {
        await stream.close();
        await this.node.hangUp(connection.remotePeer);
      } catch {}
    }
  }

  /**
   * Dials a target peer and proves our identity by signing a generated nonce.
   * @param targetPeerId
   * @returns true if server responded OK (and thus peer verified) otherwise false
   */
  async runAuthClient(targetPeerId: PeerId): Promise<boolean> {
    if (!this.config.nodeKey) {
      throw new Error('PeerAuthenticator requires nodeKey');
    }

    const timestamp = Date.now();
    const nonce = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);

    const contextStr = this.generateNonce(this.node.peerId.toString(), targetPeerId.toString(), timestamp, nonce);
    const hashed = sha256(contextStr);
    const message = uint8ArrayFromString(hashed);
    const sig = await ed.signAsync(message, this.config.nodeKey.secret);
    const pub = await ed.getPublicKeyAsync(this.config.nodeKey.secret);

    const authMessage: AuthSignMessage = {
      pub: bytesToBase64Url(pub),
      sig: bytesToBase64Url(sig),
      timestamp,
      nonce,
    };

    const stream = await this.node.dialProtocol(targetPeerId, this.config.authProtocol);
    await this.framedStream.writeToStream(stream, authMessage);
    const response = (await this.framedStream.readFromStream(stream)) as AuthSignResponse;

    return !!response.isVerified;
  }
}

export const peerAuthenticator = (): DeChatFactory<PeerAuthenticator> => {
  return (components) => new PeerAuthenticator(components);
};
