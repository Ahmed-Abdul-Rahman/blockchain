# @dechat/chat

Deep application module over `@dechat/core`. Callers use `createChatClient` — they do not wire `DeChatStrategies`.

**Topology (v1):** hybrid mesh. Browser clients dial a Node peer that listens on `/ws`. There is no browser-only mesh yet (ADR-0004).

**Rooms (v1):** open rooms — any **verified peer** on this mesh may `joinRoom` (no invite). You must join to send or pull that room. `infoHash` / network ID only selects which DeChat mesh you are on, not which rooms you may enter. Capability/invite rooms are later.

**Identity:** the **identity seed** (`nodeSeed`) is the root of the PeerId. Generate it with `generateIdentitySeed()`, persist it yourself, pass it to `createChatClient`. IndexedDB (browser) stores **replicas**, not the seed. In-memory Node stores neither across process restarts. This is not a secure vault.

**E2EE (ADR-0006):** message **bodies** are AES-256-GCM. The replica store holds ciphertext. Room keys stay in process memory and are offered to verified peers over Noise when they join. Open-room joiners can obtain the current key. Tombstones stay metadata. Call `rotateRoomKey` after a member leaves if you want a new epoch.

## Config

| Field | Role |
|-------|------|
| `infoHash` | Mesh id (which DeChat network). Not a room ticket. |
| `nodeSeed` | Identity seed → PeerId |
| `config.network.listenAddrs` | Node listen multiaddrs. Bootstrap peers should include TCP **and** `/ws`. |
| `config.network.bootstrapPeers` | Multiaddrs of a running Node bootstrap. Browsers need `/ws` or `/wss`. |

```ts
import {
  createChatClient,
  generateIdentitySeed,
  peerIdFromIdentitySeed,
} from '@dechat/chat'; // Node
// import { createChatClient } from '@dechat/chat/browser';

const nodeSeed = generateIdentitySeed(); // persist this yourself
const previewPeerId = await peerIdFromIdentitySeed(nodeSeed);

const client = await createChatClient({
  infoHash: 'my-network',
  nodeSeed,
  config: {
    network: {
      listenAddrs: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
      bootstrapPeers: [], // Node bootstrap; browser clients must set a /ws multiaddr
    },
  },
});

await client.start();
client.setDisplayName('alice'); // unsigned; peers see untrustedDisplayName
await client.joinRoom('lobby');
await client.sendMessage('lobby', { text: 'hello' });
const history = await client.getHistory('lobby');
await client.stop();
```

## Local hybrid loop (bootstrap + two Node clients)

1. Start a bootstrap peer (TCP + WebSocket). It prints multiaddrs and stays running:

```bash
yarn workspace @dechat/chat bootstrap
# optional: DECHAT_INFO_HASH=my-network DECHAT_NODE_SEED=stable-seed DECHAT_LISTEN=local
```

2. Point two Node `createChatClient`s at the **TCP** multiaddr (`bootstrapPeers`). Same `infoHash`. `joinRoom`, send, `getHistory`.

3. A future browser client uses the **WS** multiaddr. Pages served over **HTTPS** cannot use `ws://` — terminate TLS with Caddy/nginx and advertise `/dns4/…/tcp/443/wss/p2p/…`. This process listens plain `/ws` only.

## Tests

| Command | What it covers |
|---------|----------------|
| `yarn workspace @dechat/chat test` | Unit tests (identity, E2EE, projection, bootstrap addrs, ChatClient) |
| `yarn test:int:chat` | Two-node room convergence + bootstrap + two clients |

CI runs these in a dedicated `chat-interop` job (units, then interop), separate from core startup/data-sync interop.
