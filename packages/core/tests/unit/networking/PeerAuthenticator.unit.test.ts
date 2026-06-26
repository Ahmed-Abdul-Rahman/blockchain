/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */

import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeChatComponents } from '../../../src/types';

// 1. Mock network stream utilities to avoid complex buffer/iterable orchestration
vi.mock('../../../src/shared/streamUtils', () => ({
  readFromStream: vi.fn(),
  writeToStream: vi.fn(),
}));

import { readFromStream, writeToStream } from '../../../src/shared/streamUtils';

// 2. Mock cryptography to securely test logical branches without CPU overhead
vi.mock('@noble/ed25519', () => ({
  verifyAsync: vi.fn().mockResolvedValue(true),
  signAsync: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  getPublicKeyAsync: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
  utils: { randomSecretKey: vi.fn().mockReturnValue(new Uint8Array(32)) },
}));

import * as ed from '@noble/ed25519';
import { PeerAuthenticator, peerAuthenticator } from '../../../src/networking/PeerAuthenticator';

describe('PeerAuthenticator', () => {
  let authenticator: PeerAuthenticator;
  let mockComponents: Partial<DeChatComponents>;
  let mockNode: any;
  let mockPexService: any;
  let mockMetrics: any;
  const authProtocol = '/deChat/core/auth/1.0.0';

  beforeEach(async () => {
    mockNode = {
      peerId: await createEd25519PeerId(),
      handle: vi.fn(),
      unhandle: vi.fn(),
      dialProtocol: vi.fn(),
      hangUp: vi.fn(),
    };

    mockPexService = {
      addPeers: vi.fn(),
      initiatePeerExchange: vi.fn(),
    };

    mockMetrics = {
      verificationSucceeded: vi.fn(),
      verificationFailed: vi.fn(),
      authAttempted: vi.fn(),
    };

    mockComponents = {
      libp2p: mockNode as any,
      pexService: mockPexService as any,
      config: {
        peerAuthenticator: {
          authProtocol,
          networkId: 'deChat-core-net-v1',
          maxCount: 5000,
          replayCacheWindowMs: 60_000,
          nodeKey: { secret: new Uint8Array(), pub: new Uint8Array() },
        },
      } as any,
      // FIX: Changed "auth" to "authMetrics" to match the class implementation
      metrics: { authMetrics: mockMetrics } as any,
    };

    authenticator = peerAuthenticator()(mockComponents as DeChatComponents);
  });

  afterEach(() => {
    authenticator?.stop();
    vi.clearAllMocks();
  });

  it('should register AUTH_PROTOCOL handler on start', () => {
    authenticator.start();
    expect(mockNode.handle).toHaveBeenCalledWith(authProtocol, expect.any(Function));
  });

  it('should unhandle protocol and clear cache on stop', () => {
    authenticator.start();
    authenticator.stop();
    expect(mockNode.unhandle).toHaveBeenCalledWith(authProtocol);
  });

  it('runAuthClient should throw if nodeKey is missing', async () => {
    authenticator.start();

    // FIX: Simulate missing nodeKey directly to trigger the runtime check
    (authenticator as any).config.nodeKey = undefined;
    const targetPeerId = await createEd25519PeerId();

    await expect(authenticator.runAuthClient(targetPeerId as any)).rejects.toThrow(
      'PeerAuthenticator requires nodeKey', // FIX: Match updated exact error string
    );
  });

  it('runAuthClient should send auth payload and return true if verified', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    authenticator.start();

    const targetPeerId = await createEd25519PeerId();
    const mockStream = { close: vi.fn() };
    mockNode.dialProtocol.mockResolvedValue(mockStream);

    // Mock the server returning a success payload
    (readFromStream as any).mockResolvedValueOnce({ isVerified: true });

    const result = await authenticator.runAuthClient(targetPeerId as any);

    expect(result).toBe(true);
    expect(mockNode.dialProtocol).toHaveBeenCalledWith(targetPeerId, authProtocol);

    // Verify it sent the signed payload to the stream
    expect(writeToStream).toHaveBeenCalledWith(
      mockStream,
      expect.objectContaining({
        pub: expect.any(String),
        sig: expect.any(String),
        timestamp: 1_000_000,
        nonce: expect.any(String),
      }),
    );

    nowSpy.mockRestore();
  });

  it('should successfully verify an incoming peer and add them to PEX', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    authenticator.start();
    const handler = mockNode.handle.mock.calls.find((c: any) => c[0] === authProtocol)[1];

    const remotePeerId = await createEd25519PeerId();
    const mockStream = { close: vi.fn() };
    const connection = { remotePeer: remotePeerId, remoteAddr: { toString: () => '/ip4/127.0.0.1/tcp/8080' } };

    // Fake incoming message
    (readFromStream as any).mockResolvedValueOnce({
      pub: Buffer.from('valid-pub-key').toString('base64url'),
      sig: Buffer.from('valid-sig').toString('base64url'),
      nonce: 'unique-nonce-123',
      timestamp: 1_000_000,
    });

    (ed.verifyAsync as any).mockResolvedValueOnce(true);

    // Trigger the internal handler directly
    await handler({ stream: mockStream, connection });

    // Assertions
    expect(mockPexService.addPeers).toHaveBeenCalledWith([
      {
        peerId: remotePeerId.toString(),
        addresses: ['/ip4/127.0.0.1/tcp/8080'],
      },
    ]);
    expect(mockPexService.initiatePeerExchange).toHaveBeenCalled();
    expect(writeToStream).toHaveBeenCalledWith(mockStream, { isVerified: true });
    expect(mockMetrics.verificationSucceeded).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it('should reject and close stream if signature is invalid', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    authenticator.start();
    const handler = mockNode.handle.mock.calls.find((c: any) => c[0] === authProtocol)[1];

    const mockStream = { close: vi.fn() };
    const connection = { remotePeer: await createEd25519PeerId(), remoteAddr: {} };

    (readFromStream as any).mockResolvedValueOnce({
      pub: Buffer.from('valid-pub-key').toString('base64url'),
      sig: Buffer.from('bad-sig').toString('base64url'),
      nonce: 'unique-nonce-456',
      timestamp: 1_000_000,
    });

    // Mock crypto to fail the verification
    (ed.verifyAsync as any).mockResolvedValueOnce(false);

    await handler({ stream: mockStream, connection });

    expect(mockStream.close).toHaveBeenCalled();
    expect(mockMetrics.verificationFailed).toHaveBeenCalledWith('invalid_signature');
    expect(mockPexService.addPeers).not.toHaveBeenCalled(); // Ensure peer is NOT trusted

    nowSpy.mockRestore();
  });

  it('should drop messages with expired timestamps (Replay Attack Prevention)', async () => {
    authenticator.start();
    const handler = mockNode.handle.mock.calls.find((c: any) => c[0] === authProtocol)[1];

    const mockStream = { close: vi.fn() };
    const connection = { remotePeer: await createEd25519PeerId(), remoteAddr: {} };

    (readFromStream as any).mockResolvedValueOnce({
      pub: 'dummy-pub',
      sig: 'dummy-sig',
      nonce: 'nonce-789',
      // Time is over 60 seconds older than our mocked now() of 1000000
      timestamp: 500000,
    });

    await handler({ stream: mockStream, connection });

    expect(mockStream.close).toHaveBeenCalled();
    expect(ed.verifyAsync).not.toHaveBeenCalled(); // Shouldn't even bother wasting CPU checking crypto
  });

  it('should drop messages with previously used nonces (Replay Attack Prevention)', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    authenticator.start();
    const handler = mockNode.handle.mock.calls.find((c: any) => c[0] === authProtocol)[1];

    const mockStream = { close: vi.fn() };
    const connection = { remotePeer: await createEd25519PeerId(), remoteAddr: { toString: () => '/ip4/0' } };

    const payload = {
      pub: Buffer.from('valid-pub-key').toString('base64url'),
      sig: Buffer.from('valid-sig').toString('base64url'),
      nonce: 'reused-nonce',
      timestamp: 1_000_000,
    };

    // Send the message the first time
    (readFromStream as any).mockResolvedValueOnce(payload);
    await handler({ stream: mockStream, connection });
    expect(mockMetrics.verificationSucceeded).toHaveBeenCalledTimes(1);

    // Send the EXACT SAME message again
    (readFromStream as any).mockResolvedValueOnce(payload);
    await handler({ stream: mockStream, connection });

    // It should have blocked it, so successes stays at 1 and stream is closed
    expect(mockMetrics.verificationSucceeded).toHaveBeenCalledTimes(1);
    expect(mockStream.close).toHaveBeenCalled();

    nowSpy.mockRestore();
  });
});
