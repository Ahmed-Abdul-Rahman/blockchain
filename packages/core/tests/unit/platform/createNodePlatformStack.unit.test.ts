import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../../src/config/defaults';
import { createNodePlatformStack } from '../../../src/platform/createNodePlatformStack';

describe('createNodePlatformStack WebSockets', () => {
  it('adds WebSockets when listen includes /ws', () => {
    const config = resolveConfig({
      discovery: { enableMdns: false },
      network: {
        listenAddrs: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
        bootstrapPeers: [],
      },
    });
    expect(createNodePlatformStack({ config }).transports).toHaveLength(2);
  });

  it('adds WebSockets when bootstrap peers are /ws even if listen is TCP-only', () => {
    const config = resolveConfig({
      discovery: { enableMdns: false },
      network: {
        listenAddrs: ['/ip4/127.0.0.1/tcp/0'],
        bootstrapPeers: ['/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWBootstrap'],
      },
    });
    expect(createNodePlatformStack({ config }).transports).toHaveLength(2);
  });

  it('stays TCP-only when neither listen nor bootstrap uses /ws', () => {
    const config = resolveConfig({
      discovery: { enableMdns: false },
      network: {
        listenAddrs: ['/ip4/127.0.0.1/tcp/0'],
        bootstrapPeers: ['/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWBootstrap'],
      },
    });
    expect(createNodePlatformStack({ config }).transports).toHaveLength(1);
  });
});
