import { describe, expect, it } from 'vitest';
import { normalizeDialAddr, normalizeDialAddrs } from '../../../src/networking/utils';

describe('normalizeDialAddr', () => {
  const peerId = '12D3KooWExamplePeerIdForTests';

  it('rewrites 0.0.0.0 listen addrs to 127.0.0.1', () => {
    expect(normalizeDialAddr(`/ip4/0.0.0.0/tcp/40123/p2p/${peerId}`, peerId)).toBe(
      `/ip4/127.0.0.1/tcp/40123/p2p/${peerId}`,
    );
  });

  it('appends /p2p/ when missing from a transport addr', () => {
    expect(normalizeDialAddr('/ip4/127.0.0.1/tcp/40123', peerId)).toBe(`/ip4/127.0.0.1/tcp/40123/p2p/${peerId}`);
  });

  it('returns null for peer-id-only addrs', () => {
    expect(normalizeDialAddr(`/p2p/${peerId}`, peerId)).toBeNull();
  });
});

describe('normalizeDialAddrs', () => {
  const peerId = '12D3KooWExamplePeerIdForTests';

  it('deduplicates normalized addresses', () => {
    const addrs = normalizeDialAddrs([`/ip4/0.0.0.0/tcp/40123`, `/ip4/127.0.0.1/tcp/40123/p2p/${peerId}`], peerId);

    expect(addrs).toEqual([`/ip4/127.0.0.1/tcp/40123/p2p/${peerId}`]);
  });
});
