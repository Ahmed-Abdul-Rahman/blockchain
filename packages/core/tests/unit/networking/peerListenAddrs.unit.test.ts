import type { PeerId } from '@libp2p/interface';
import { describe, expect, it, vi } from 'vitest';
import { peerListenAddrs } from '../../../src/networking/peerListenAddrs';

describe('peerListenAddrs', () => {
  it('prefers Identify listen addrs from the peerstore', async () => {
    const peerId = { toString: () => '12D3KooWPeer' } as unknown as PeerId;
    const node = {
      peerStore: {
        get: vi.fn().mockResolvedValue({
          addresses: [{ multiaddr: { toString: () => '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWPeer' } }],
        }),
      },
    };

    await expect(peerListenAddrs(node, peerId, ['/ip4/127.0.0.1/tcp/9'])).resolves.toEqual([
      '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWPeer',
    ]);
  });

  it('falls back to the connection remote addr when Identify has not populated the store', async () => {
    const peerId = { toString: () => '12D3KooWPeer' } as unknown as PeerId;
    const node = {
      peerStore: {
        get: vi.fn().mockRejectedValue(new Error('not found')),
      },
    };

    await expect(peerListenAddrs(node, peerId, ['/ip4/127.0.0.1/tcp/9'])).resolves.toEqual(['/ip4/127.0.0.1/tcp/9']);
  });
});
