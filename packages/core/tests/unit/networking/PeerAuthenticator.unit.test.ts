/** biome-ignore-all lint/suspicious/noExplicitAny: <its a test file> */

import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeChatComponents } from '../../../src/types';

const { mockReadFromStream, mockWriteToStream } = vi.hoisted(() => ({
  mockReadFromStream: vi.fn(),
  mockWriteToStream: vi.fn(),
}));

vi.mock('../../../src/shared/serialization/framedStreamCodec', () => ({
  createFramedStreamCodec: vi.fn(() => ({
    readFromStream: mockReadFromStream,
    writeToStream: mockWriteToStream,
    readMessagesFromStream: vi.fn(),
    setupRPCStream: vi.fn(),
  })),
}));

vi.mock('@noble/ed25519', () => ({
  verifyAsync: vi.fn().mockResolvedValue(true),
  signAsync: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  getPublicKeyAsync: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
  utils: { randomSecretKey: vi.fn().mockReturnValue(new Uint8Array(32)) },
}));

import * as ed from '@noble/ed25519';
import { PeerAuthenticator, peerAuthenticator } from '../../../src/networking/PeerAuthenticator';
import { createCborWireSerializer } from '../../../src/shared/serialization';

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
      serializer: createCborWireSerializer(),
      config: {
        peerAuthenticator: {
          authProtocol,
          networkId: 'deChat-core-net-v1',
          maxCount: 5000,
          replayCacheWindowMs: 60_000,
          nodeKey: { secret: new Uint8Array(), pub: new Uint8Array() },
        },
      } as any,
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

    (authenticator as any).config.nodeKey = undefined;
    const targetPeerId = await createEd25519PeerId();

    await expect(authenticator.runAuthClient(targetPeerId as any)).rejects.toThrow(
      'PeerAuthenticator requires nodeKey',
    );
  });

  it('runAuthClient should send auth payload and return true if verified', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    authenticator.start();

    const targetPeerId = await createEd25519PeerId();
    const mockStream = { close: vi.fn() };
    mockNode.dialProtocol.mockResolvedValue(mockStream);

    mockReadFromStream.mockResolvedValueOnce({ isVerified: true });

    const result = await authenticator.runAuthClient(targetPeerId as any);

    expect(result).toBe(true);
    expect(mockNode.dialProtocol).toHaveBeenCalledWith(targetPeerId, authProtocol);

    expect(mockWriteToStream).toHaveBeenCalledWith(
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

    mockReadFromStream.mockResolvedValueOnce({
      pub: Buffer.from('valid-pub-key').toString('base64url'),
      sig: Buffer.from('valid-sig').toString('base64url'),
      nonce: 'unique-nonce-123',
      timestamp: 1_000_000,
    });

    (ed.verifyAsync as any).mockResolvedValueOnce(true);

    await handler({ stream: mockStream, connection });

    expect(mockPexService.addPeers).toHaveBeenCalledWith([
      {
        peerId: remotePeerId.toString(),
        addresses: ['/ip4/127.0.0.1/tcp/8080'],
      },
    ]);
    expect(mockPexService.initiatePeerExchange).toHaveBeenCalled();
    expect(mockWriteToStream).toHaveBeenCalledWith(mockStream, { isVerified: true });
    expect(mockMetrics.verificationSucceeded).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it('should reject and close stream if signature is invalid', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    authenticator.start();
    const handler = mockNode.handle.mock.calls.find((c: any) => c[0] === authProtocol)[1];

    const mockStream = { close: vi.fn() };
    const connection = { remotePeer: await createEd25519PeerId(), remoteAddr: {} };

    mockReadFromStream.mockResolvedValueOnce({
      pub: Buffer.from('valid-pub-key').toString('base64url'),
      sig: Buffer.from('bad-sig').toString('base64url'),
      nonce: 'unique-nonce-456',
      timestamp: 1_000_000,
    });

    (ed.verifyAsync as any).mockResolvedValueOnce(false);

    await handler({ stream: mockStream, connection });

    expect(mockStream.close).toHaveBeenCalled();
    expect(mockMetrics.verificationFailed).toHaveBeenCalledWith('invalid_signature');
    expect(mockPexService.addPeers).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it('should drop messages with expired timestamps (Replay Attack Prevention)', async () => {
    authenticator.start();
    const handler = mockNode.handle.mock.calls.find((c: any) => c[0] === authProtocol)[1];

    const mockStream = { close: vi.fn() };
    const connection = { remotePeer: await createEd25519PeerId(), remoteAddr: {} };

    mockReadFromStream.mockResolvedValueOnce({
      pub: 'dummy-pub',
      sig: 'dummy-sig',
      nonce: 'nonce-789',
      timestamp: 500000,
    });

    await handler({ stream: mockStream, connection });

    expect(mockStream.close).toHaveBeenCalled();
    expect(ed.verifyAsync).not.toHaveBeenCalled();
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

    mockReadFromStream.mockResolvedValueOnce(payload);
    await handler({ stream: mockStream, connection });
    expect(mockMetrics.verificationSucceeded).toHaveBeenCalledTimes(1);

    mockReadFromStream.mockResolvedValueOnce(payload);
    await handler({ stream: mockStream, connection });

    expect(mockMetrics.verificationSucceeded).toHaveBeenCalledTimes(1);
    expect(mockStream.close).toHaveBeenCalled();

    nowSpy.mockRestore();
  });
});
