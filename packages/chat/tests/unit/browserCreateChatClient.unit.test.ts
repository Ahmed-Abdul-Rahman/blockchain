import { describe, expect, it } from 'vitest';
import { createChatClient } from '../../src/browser';

describe('browser createChatClient', () => {
  it('refuses to start without a /ws or /wss bootstrap multiaddr', async () => {
    await expect(
      createChatClient({
        infoHash: 'browser-chat',
        nodeSeed: 'browser-seed',
        config: { network: { bootstrapPeers: [] } },
      }),
    ).rejects.toThrow(/at least one/);

    await expect(
      createChatClient({
        infoHash: 'browser-chat',
        nodeSeed: 'browser-seed',
        config: { network: { bootstrapPeers: ['/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTcp'] } },
      }),
    ).rejects.toThrow(/\/ws/);
  });
});
