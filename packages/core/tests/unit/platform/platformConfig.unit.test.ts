import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../../src/config/defaults';

describe('platform-aware resolveConfig', () => {
  it('defaults to node profile with TCP listen and mDNS', () => {
    const config = resolveConfig();
    expect(config.platform.kind).toBe('node');
    expect(config.discovery.enableMdns).toBe(true);
    expect(config.network.listenAddrs.length).toBeGreaterThan(0);
  });

  it('applies browser profile defaults and requires bootstrap', () => {
    expect(() =>
      resolveConfig({
        platform: { kind: 'browser' },
      }),
    ).toThrow(/Invalid DeChat node configuration/);

    const config = resolveConfig({
      platform: { kind: 'browser' },
      network: {
        bootstrapPeers: ['/ip4/127.0.0.1/tcp/1234/ws/p2p/12D3KooWBootstrap'],
      },
    });
    expect(config.platform.kind).toBe('browser');
    expect(config.discovery.enableMdns).toBe(false);
    expect(config.network.listenAddrs).toEqual([]);
  });

  it('clears default TCP listen addrs when browser passes empty listenAddrs', () => {
    const config = resolveConfig({
      platform: { kind: 'browser' },
      network: {
        listenAddrs: [],
        bootstrapPeers: ['/ip4/127.0.0.1/tcp/1234/ws/p2p/12D3KooWBootstrap'],
      },
    });
    expect(config.network.listenAddrs).toEqual([]);
  });

  it('rejects LEVEL_DB on browser profile', () => {
    expect(() =>
      resolveConfig({
        platform: { kind: 'browser' },
        network: {
          bootstrapPeers: ['/ip4/127.0.0.1/tcp/1234/ws/p2p/12D3KooWBootstrap'],
        },
        strategies: {
          store: { type: 'LEVEL_DB', dbPath: './levelDB' },
        },
      }),
    ).toThrow(/Invalid DeChat node configuration/);
  });
});
