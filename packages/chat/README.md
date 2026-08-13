# @dechat/chat

Deep application module over `@dechat/core`. Callers use `createChatClient` — they do not wire `DeChatStrategies`.

**Topology (v1):** hybrid mesh. Browser clients dial a Node peer that listens on `/ws`. There is no browser-only mesh yet (ADR-0004).

**Rooms (v1):** open rooms — anyone on the same `infoHash` / network ID may `joinRoom`. Capability/invite rooms and E2EE are later.

```ts
import { createChatClient } from '@dechat/chat'; // Node
// import { createChatClient } from '@dechat/chat/browser';

const client = await createChatClient({
  infoHash: 'my-network',
  nodeSeed: 'stable-seed',
  config: {
    network: {
      listenAddrs: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
      bootstrapPeers: [], // Node bootstrap; browser clients must set a /ws multiaddr
    },
  },
});

await client.start();
await client.joinRoom('lobby');
await client.sendMessage('lobby', { text: 'hello' });
const history = await client.getHistory('lobby');
await client.stop();
```
