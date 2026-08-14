/**
 * Browser-side Playwright harness. Bundled by esbuild (platform: browser) and served over HTTP.
 * Reports status on `globalThis.__dechat` for the Node-side test to poll.
 */
import { multiaddr } from '@multiformats/multiaddr';
import { createBrowserNode, portableTopicReplicationStrategies } from '../../browser';

type SmokeStatus = {
  readonly status: 'starting' | 'ready' | 'verified' | 'failed';
  readonly error?: string;
  readonly peerId?: string;
  readonly registrySize?: number;
  readonly connections?: number;
};

const report = (state: SmokeStatus): void => {
  (globalThis as typeof globalThis & { __dechat: SmokeStatus }).__dechat = state;
};

report({ status: 'starting' });

const params = new URLSearchParams(globalThis.location.search);
const bootstrap = params.get('bootstrap');
const bootstrapPeerId = params.get('bootstrapPeerId') ?? '';
const infoHash = params.get('infoHash') ?? 'playwright-hybrid-v1';

if (!bootstrap) {
  report({ status: 'failed', error: 'missing bootstrap query param' });
} else {
  const run = async (): Promise<void> => {
    const client = await createBrowserNode(infoHash, 'pw-browser-client', {
      config: {
        network: {
          bootstrapPeers: [bootstrap],
          listenAddrs: [],
        },
      },
      strategies: portableTopicReplicationStrategies(),
    });

    await client.start();
    const peerId = client.components.libp2p.peerId.toString();
    report({ status: 'ready', peerId, registrySize: 0, connections: 0 });

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const peers = client.components.peerRegistry.getPeers();
      const connections = client.components.libp2p.getConnections().length;
      const matched = bootstrapPeerId ? peers.includes(bootstrapPeerId) : peers.length > 0;
      if (matched) {
        report({ status: 'verified', peerId, registrySize: peers.length, connections });
        return;
      }
      if (connections === 0) {
        try {
          await client.components.libp2p.dial(multiaddr(bootstrap));
        } catch {
          /* retry */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    report({
      status: 'failed',
      error: `registry not ready. size=${client.components.peerRegistry.getSize()} conns=${client.components.libp2p.getConnections().length}`,
      peerId,
      registrySize: client.components.peerRegistry.getSize(),
      connections: client.components.libp2p.getConnections().length,
    });
  };

  run().catch((err: unknown) => {
    report({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
  });
}
