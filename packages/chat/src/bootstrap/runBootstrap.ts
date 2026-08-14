/**
 * Node bootstrap recipe: listen TCP+WS, print multiaddrs, stay up until SIGINT.
 *
 *   yarn workspace @dechat/chat bootstrap
 *
 * Env: DECHAT_INFO_HASH, DECHAT_NODE_SEED (optional — generated if omitted),
 * DECHAT_LISTEN=local|lan (default lan = 0.0.0.0).
 */
import { logger } from '@dechat/common';
import { generateIdentitySeed } from '../identity/identitySeed';
import { createBootstrapPeer } from './createBootstrapPeer';
import { LAN_HYBRID_LISTEN_ADDRS, LOCAL_HYBRID_LISTEN_ADDRS, pickTcpListenAddr, pickWsListenAddr } from './listenAddrs';

const infoHash = process.env.DECHAT_INFO_HASH?.trim() || 'dechat-local';
const nodeSeed = process.env.DECHAT_NODE_SEED?.trim() || generateIdentitySeed();
const listenLocal = process.env.DECHAT_LISTEN === 'local';

const client = await createBootstrapPeer({
  infoHash,
  nodeSeed,
  config: {
    network: {
      listenAddrs: listenLocal ? [...LOCAL_HYBRID_LISTEN_ADDRS] : [...LAN_HYBRID_LISTEN_ADDRS],
      bootstrapPeers: [],
    },
  },
});

await client.start();
const addrs = client.getListenAddrs();
const tcp = pickTcpListenAddr(addrs);
const ws = pickWsListenAddr(addrs);

logger.info('[bootstrap] peerId', client.peerId);
logger.info('[bootstrap] TCP  (Node clients)', tcp);
logger.info('[bootstrap] WS   (browser clients)', ws);
logger.info('[bootstrap] Same infoHash on clients:', infoHash);
if (!process.env.DECHAT_NODE_SEED) {
  logger.info('[bootstrap] Generated nodeSeed (persist to reuse this peerId):', nodeSeed);
}
logger.info(
  '[bootstrap] HTTPS pages cannot use plain ws:// — terminate TLS (Caddy/nginx) and advertise a /wss multiaddr.',
);

const shutdown = async (): Promise<void> => {
  await client.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
