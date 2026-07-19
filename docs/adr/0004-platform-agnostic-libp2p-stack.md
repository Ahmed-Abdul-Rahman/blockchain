---
status: accepted
---

# Platform-agnostic libp2p stack (Node + Browser)

DeChat’s protocol layers (auth, PEX, dial queue, gossip, replication, anti-entropy) are already portable. What is not portable is the composition root’s transport/discovery wiring and a few Node I/O helpers in `@dechat/crypto` / `@dechat/common`.

We isolate platform I/O behind a small **`Libp2pPlatformStack`** seam injected into `createNode`, with two adapters: **Node** (TCP + optional mDNS/bootstrap, today’s behaviour) and **Browser** (WebSockets dial + bootstrap; no TCP/mDNS). Supporting packages use conditional exports so browser bundles never pull LevelDB, rotating file logs, or Node `crypto`/`fs`.

## Why this shape

| Option | Rejected because |
|--------|------------------|
| `if (isBrowser)` inside protocols | Sprays platform checks through networking/replication; breaks deep-module locality |
| Polyfill `fs`/`crypto`/`level` in the bundler | Heavy, fragile, and fights tree-shaking; we reject polyfill-as-strategy |
| Separate browser fork of core | Doubles protocol maintenance |

## Topology (v1)

Hybrid mesh is the product: **Node** peers listen (bootstrap / relay roles); **browser client peers** dial at least one bootstrap multiaddr. Browser↔browser and WebTransport-only paths are out of scope for v1.

## Consequences

- Protocol modules depend on libp2p interfaces + `ReplicaStoreInterface` + portable crypto — never `@libp2p/tcp` / `@libp2p/mdns`.
- Public facades: `createNode` (default Node stack), `createBrowserNode` (browser stack).
- Config uses a platform profile so illegal combos (e.g. TCP listen on browser) are rejected at resolve time.
