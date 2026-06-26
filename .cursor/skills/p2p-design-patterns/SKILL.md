---
name: p2p-design-patterns
description: Production P2P engineering patterns distilled from ethereumjs-monorepo — layered networking stack, node/peer lifecycle state machines, EventEmitter-based event handling, discovery (DPT/Kademlia k-buckets), encrypted transport (RLPx/ECIES), capability negotiation, sub-protocol routing, and monorepo package design. Use when structuring a P2P node's architecture, lifecycle, events, or network layers in TypeScript.
---

# P2P Design Patterns

Reusable architecture patterns for building a P2P node in TypeScript, extracted from the [ethereumjs-monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) — specifically `@ethereumjs/devp2p` (Ethereum's P2P stack) plus the monorepo's package/state-management conventions.

> Note: `@ethereumjs/devp2p` is now deprecated upstream, but its design is a battle-tested, readable reference for how a real P2P networking layer is structured. The *patterns* — not the Ethereum wire details — are what's valuable for DeChat.

For DeChat's concrete wiring use `/libp2p-core-patterns`; for theory use `/p2p-fundamentals`; for wire protocols use `/libp2p-spec`.

## 1. Layered networking stack

devp2p separates the stack into three independently testable layers. The same separation maps onto DeChat.

| Layer | devp2p | Responsibility | DeChat analogue |
|-------|--------|----------------|-----------------|
| **Discovery** | DPT (Distributed Peer Table) | Find peers, maintain k-buckets, ban list | mDNS + bootstrap + `PeerExchangeService` |
| **Transport / session** | RLPx + ECIES | Encrypted, authenticated connection; peer session; ping/pong; capability negotiation | libp2p Noise + yamux + `PeerAuthenticator` |
| **Application / sub-protocol** | ETH / SNAP wire protocols | Domain messages over a session | `*Propagation` + `*Replication` layers |

**Pattern:** each layer depends only on the one below and communicates **upward via events**. Discovery doesn't know about wire messages; the wire protocol doesn't know how peers were discovered. This is the seam that makes each layer mockable in isolation.

```
Application sub-protocols (ETH/SNAP  ·  DeChat propagation/replication)
        │  events: 'message', 'status'
Session/transport (RLPx Peer  ·  libp2p connection)
        │  events: 'peer:added', 'peer:removed', 'peer:error'
Discovery (DPT k-bucket  ·  mDNS/PEX)
        │  events: 'peer:new', 'peer:added', 'peer:removed'
```

## 2. EventEmitter as the integration backbone

Every devp2p component exposes a public `events` property (an `EventEmitter`) rather than baking callbacks into method signatures.

```ts
class DPT  { public events: EventEmitter /* peer:added, peer:removed, peer:new, listening, close, error */ }
class RLPx { public events: EventEmitter /* peer:added, peer:removed, peer:error, listening, close, error */ }
class Peer { public events: EventEmitter /* connect, close, error + per-subprotocol 'message','status' */ }
class ETH  { public events: EventEmitter /* message, status */ }
```

**Patterns to copy:**
- **Composition over inheritance for events** — hold an `events` field (`new EventEmitter()`), don't `extends EventEmitter`. Keeps the public method surface clean and the emitter swappable/mockable.
- **Event forwarding** — lower layers re-emit selected events upward (`listening`, `close`, `error` are forwarded from the server through DPT). Lets the top level subscribe once.
- **Lifecycle events are first-class** — `peer:added` fires only **after a successful handshake**, `peer:removed` on disconnect, `peer:error` on failure. Consumers never see a half-open peer.
- **Typed event names by stage** — discovery emits `peer:new` (candidate) vs RLPx `peer:added` (authenticated). Distinguish *known* from *trusted* peers via distinct events.

> DeChat rule alignment: **never store a peer in the registry until auth succeeds.** Mirror devp2p — only act on the post-handshake `peer:added`-equivalent event.

## 3. Node & peer lifecycle as an explicit state machine

The RLPx `Peer` tracks explicit state rather than ad-hoc booleans scattered around:

```ts
class Peer {
  protected _state: string          // explicit handshake/auth state
  protected _connected: boolean
  protected _closed: boolean
  protected _disconnectReason?: DISCONNECT_REASON
  protected _pingIntervalId: NodeJS.Timeout | null
  protected _pingTimeoutId:  NodeJS.Timeout | null
  _protocols: ProtocolDescriptor[]  // sub-protocols negotiated for THIS peer
}
```

**Connection lifecycle (RLPx):**
1. **ECIES handshake** — auth/ack encrypted key exchange establishes the secure session.
2. **HELLO exchange** — base-protocol message announcing `protocolVersion`, `clientId`, `capabilities`, `port`, `id`.
3. **Capability negotiation** — intersect local and remote capabilities → instantiate matching sub-protocols (`ETH`, `SNAP`) as `ProtocolDescriptor`s with message-code offsets.
4. **Active** — base messages (`HELLO`, `DISCONNECT`, `PING`, `PONG`) plus sub-protocol messages are demultiplexed by code offset.
5. **DISCONNECT** — explicit reason code; `_disconnectWe` records who initiated.

**Base protocol message prefixes** (every P2P session needs an equivalent control channel):

```ts
const PREFIXES = { HELLO: 0x00, DISCONNECT: 0x01, PING: 0x02, PONG: 0x03 }
const PING_INTERVAL = 15000  // keepalive heartbeat
```

**Patterns to copy:**
- **Liveness via PING/PONG heartbeat** with a timeout that triggers eviction — the universal churn-detection mechanism (same idea as Kademlia pings, GossipSub heartbeat).
- **Explicit disconnect reasons** (`DISCONNECT_REASON` enum + name map) for debuggability — never disconnect silently.
- **Per-peer protocol set** (`_protocols`) negotiated at handshake — supported protocols are scoped to the connection, not global (matches libp2p's "don't assume protocols are static").
- **Clean teardown** — clear all timers (`_pingIntervalId`, `_pingTimeoutId`) on close; track `_closed`/`_connected` to make teardown idempotent. Critical for DeChat's worker-thread integration tests (a leaked timer or socket hangs CI).

## 4. Discovery: Kademlia k-bucket pattern (DPT)

`DPT` (Distributed Peer Table) is a concrete Kademlia implementation worth studying:

- **`Kbucket`** — XOR-distance-organized buckets of known peers (the routing table).
- **`BanList`** — explicit, separate structure for misbehaving peers (don't overload the routing table with trust state).
- **`Server`** — UDP node discovery: `ping`, `pong`, `findNeighbours`.
- **Periodic refresh** — `refreshInterval` (default 60s) re-runs `findNeighbours` to adapt to churn.
- **Multiple discovery sources behind one interface** — k-bucket walking **and** EIP-1459 DNS lists (`shouldGetDnsPeers`, `dnsNetworks`) feed the same table. New sources plug in without changing consumers.

**Pattern:** keep **routing state**, **trust/ban state**, and **transport** as separate collaborators behind one façade (`DPT`). DeChat mirrors this: `PeerRegistry` (routing), `SimplePeerScorer`/ban (trust), libp2p (transport), `PeerExchangeService` (a discovery source).

## 5. Encrypted transport & authentication (RLPx / ECIES)

- **`ECIES`** session object owns the cryptographic handshake (auth/ack, derive shared secrets, frame MACs). Crypto is isolated in one module, not smeared across the peer.
- **Throttling**: `maxPeers` caps connections; `remoteClientIdFilter` rejects unwanted client implementations early.
- **Identity = key**: the node's private key signs/encodes discovery messages and derives its node id — identity and crypto are unified (same as libp2p Ed25519 peer ids).

**Pattern:** put the handshake/crypto in a dedicated object (`ECIES` ↔ DeChat `PeerAuthenticator`), and **gate peer registration on its success**.

## 6. Sub-protocol routing pattern

devp2p multiplexes several wire protocols over one session by **message-code offsets**:

```ts
interface ProtocolDescriptor { protocol: Protocol; offset: number; length?: number }
```

- The base protocol reserves codes `0x00–0x0f` (`BASE_PROTOCOL_LENGTH = 16`).
- Each negotiated sub-protocol gets a contiguous code range starting at its `offset`.
- Incoming messages are demuxed: `code < offset+length` routes to that sub-protocol.
- Each sub-protocol (`ETH`) is constructed with `(version, peer, send)` — a **wrapped `send` function** injected so the sub-protocol routes output through the peer without knowing socket details (dependency injection).

**Application handshake pattern (ETH):** open with a `status` exchange (`sendStatus`), gate all further messages on receiving the peer's matching `status`. Reject mismatched networks/genesis early.

> DeChat parallel: distinct libp2p protocol ids per concern (broadcast vs direct propagation, replication protocol), each handler injected its transport, each with its own readiness/handshake gate.

## 7. Configuration via a shared "Common" object

The monorepo threads a single `Common` instance (chain id, hardfork rules, network params) through every layer (`block`, `tx`, `vm`, `devp2p`, `client`). One source of truth for cross-cutting config, passed by injection rather than read from globals.

**Pattern:** a single typed config/strategy object injected at construction (DeChat: `DeChatStrategies` / node options) instead of scattered constants or env reads.

## 8. Monorepo / package design conventions

From the ethereumjs ARCHITECTURE and package layout — directly applicable to DeChat's Yarn workspaces:

- **One concern per package**, depended on via an explicit DAG (util→common→{block,tx,...}→vm→client). Keep the dependency graph acyclic and documented (they render it as a Mermaid graph in the README).
- **Strict TypeScript, ES Modules, `.ts` extension imports**, Biome for lint/format — same stack as DeChat.
- **`events` + typed options objects** as the public API of each package.
- **Examples as living docs** — runnable `examples/*.ts` (e.g. `peer-communication`) double as integration smoke tests with `DEBUG=...` namespaced logging.
- **Namespaced debug logging** (`debug` with names like `devp2p:rlpx:peer`) — turn on per-layer tracing without code changes. DeChat should log through `@dechat/common` logger with similar layer namespaces.

## Pattern checklist for a P2P node

When building or reviewing a P2P node layer, verify:

- [ ] Layers (discovery / session / application) are separated and depend downward only
- [ ] Each component exposes an `events` emitter; lifecycle events fire only after success
- [ ] Peer state is an **explicit** machine (`_state`, `_connected`, `_closed`, disconnect reason)
- [ ] PING/PONG (or equivalent) heartbeat + timeout drives churn detection
- [ ] Crypto/handshake isolated in one object; **registration gated on auth success**
- [ ] Connection limits / throttling enforced (`maxPeers`-style)
- [ ] Routing state, trust/ban state, and transport are separate collaborators
- [ ] Sub-protocols negotiated per-peer and routed by id/offset, transport injected
- [ ] All timers/sockets torn down idempotently on close (no leaked handles → no hung CI)
- [ ] Config flows through one injected object, not globals
- [ ] Per-layer namespaced debug logging

## DeChat mapping summary

| ethereumjs pattern | DeChat home |
|--------------------|-------------|
| DPT / k-bucket / ban list | `PeerRegistry`, `SimplePeerScorer`, `PeerExchangeService` |
| RLPx Peer session + state machine | libp2p connection + `node.ts` peer handling |
| ECIES handshake | `PeerAuthenticator` (Ed25519) |
| EventEmitter forwarding | libp2p event wiring in `createNode` |
| Sub-protocol by protocol id | `GossipSubPropagation`, `DirectStreamPropagation`, replication protocols |
| `Common` config | `DeChatStrategies` / node options |
| Monorepo DAG + examples + debug | Yarn workspaces, interop worker-thread tests, `@dechat/common` logger |

## Related skills

| Skill | Use for |
|-------|---------|
| `/libp2p-core-patterns` | Concrete `@dechat/core` implementation (createNode, strategies) |
| `/libp2p-spec` | Wire-protocol details these patterns sit on top of |
| `/p2p-fundamentals` | Kademlia/DHT/replication theory behind the patterns |
| `/codebase-design` | Designing the deep-module seams between these layers |
