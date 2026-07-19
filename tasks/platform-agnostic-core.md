# Task: Platform-Agnostic `@dechat/core` (Node + Browser)

**Status:** Approved — implementing on `feature/platform-agnostic-core`  
**Goal:** Run the DeChat P2P engine in **browser JS** as well as Node, without rewriting protocol layers  
**Non-goal (v1):** Pure browser-only mesh with zero Node/relay peers; Compose WebRTC nodes; replacing libp2p  
**Related:** [BACKLOG.md](../BACKLOG.md) (Browser / WebRTC called out as Tier-2 compose out-of-scope); canvas [core-browser-portability](file:///Users/ahmedabdulrahman/.cursor/projects/Users-ahmedabdulrahman-Documents-Programs-git-repos-de-chat/canvases/core-browser-portability.canvas.tsx)

---

## Executive summary

Most of `@dechat/core` is already **platform-portable** (auth, PEX, dial queue, gossip, replication, anti-entropy). What is not portable is the **composition root** (`createNode`) and a handful of **Node I/O dependencies** in `@dechat/crypto` and `@dechat/common`.

This plan classifies every concern into one of three buckets:

| Bucket | Meaning | Action |
|--------|---------|--------|
| **A — Portable** | Works in browser as-is (or with trivial type-safe cleanup) | Leave alone; do not rewrite |
| **B — Node seam** | Real variation across platforms; needs an interface + ≥2 adapters | Extract seam; keep Node adapter; add Browser adapter |
| **C — New for browser** | No browser equivalent exists today | Implement new adapter / capability |

**Design principle:** Isolate platform I/O at a small number of deep seams. Protocol modules stay pure consumers of libp2p + `ReplicaStoreInterface` + crypto helpers. Do not sprinkle `if (isBrowser)` through networking/replication code.

**Success for v1 (MVP):** A browser bundle can create a DeChat node, dial a Node bootstrap/relay peer over WebSocket (and/or WebRTC), complete auth, and complete one replication / anti-entropy round-trip. Node path remains green on existing unit + interop tests.

---

## Skills to use during execution

Documented so implementers (human or agent) load the right skill at the right phase. Paths are under `.cursor/skills/`.

| Phase | Skill | Why |
|-------|-------|-----|
| Design / seam placement | [`codebase-design`](../.cursor/skills/codebase-design/SKILL.md) (+ [`references/DEEPENING.md`](../.cursor/skills/codebase-design/references/DEEPENING.md)) | Vocabulary: **module / interface / seam / adapter / depth**. Enforce “two adapters = real seam”. |
| Topology & CAP choices | [`designing-p2p-systems`](../.cursor/skills/designing-p2p-systems/SKILL.md) | Hybrid Node relay + browser client; discovery without mDNS; eventual consistency unchanged |
| Node wiring patterns | [`libp2p-core-patterns`](../.cursor/skills/libp2p-core-patterns/SKILL.md) | Keep `createNode` + `DeChatStrategies`; plug platform stack without editing protocol internals |
| Wire / transport facts | [`libp2p-spec`](../.cursor/skills/libp2p-spec/SKILL.md) | WebSocket, WebRTC, WebTransport, circuit-relay, Noise, yamux constraints |
| Layered stack analogy | [`p2p-design-patterns`](../.cursor/skills/p2p-design-patterns/SKILL.md) | Discovery vs session vs sub-protocol separation; EventEmitter composition (not extends) |
| P2P theory grounding | [`p2p-fundamentals`](../.cursor/skills/p2p-fundamentals/SKILL.md) | Why browsers cannot TCP-listen; NAT / relay necessity |
| Types & factories | [`typescript`](../.cursor/skills/typescript/SKILL.md) | Discriminated unions for platform config; factories over god-objects; no `any` |
| Glossary / ADR | [`domain-modeling`](../.cursor/skills/domain-modeling/SKILL.md) | ADR for platform stack; update `CONTEXT.md` terms (`PlatformStack`, relay roles) |
| Implementation cadence | [`tdd`](../.cursor/skills/tdd/SKILL.md) | Red-green for crypto/logger adapters and browser smoke; keep unit tests fast |
| Browser debug later | [`nodejs-core`](../.cursor/skills/nodejs-core/SKILL.md) | Only when diagnosing Node side of hybrid mesh (workers, event loop) — not for browser code |
| Optional architecture grill | [`improve-codebase-architecture`](../.cursor/skills/improve-codebase-architecture/SKILL.md) | If seam placement is contested before coding |

**Rule during PRs:** Cite the skill(s) used in the PR description under “Skills applied”.

---

## Architecture decisions (need approval before coding)

### D1 — Platform stack seam at composition root (not inside protocols)

Introduce a deep module:

```ts
/** Everything createNode needs that varies by runtime. */
export interface Libp2pPlatformStack {
  readonly transports: Array<() => Transport>;
  readonly streamMuxers: Array<() => StreamMuxerFactory>;
  readonly connectionEncrypters: Array<() => ConnectionEncrypter>;
  readonly peerDiscovery: Array<(components: unknown) => PeerDiscovery>;
  readonly listenAddrs: readonly string[];
  readonly services?: Record<string, unknown>; // e.g. identify extras, relay client
}
```

```
                    ┌──────────────────────────────┐
                    │  createNode (composition)    │
                    │  auth, PEX, dial, strategies │
                    └─────────────┬────────────────┘
                                  │ injects
                    ┌─────────────▼────────────────┐
                    │  Libp2pPlatformStack (seam)  │
                    └─────────────┬────────────────┘
              ┌───────────────────┼───────────────────┐
              ▼                                       ▼
   createNodePlatformStack()               createBrowserPlatformStack()
   tcp + noise + yamux                     websockets / webrtc (+ webtransport)
   mdns? + bootstrap                       bootstrap (+ relay client)
   /ip4/.../tcp/...                        dial-oriented addrs / WS listen if any
```

- **Node adapter** preserves today’s behaviour (regression-safe).
- **Browser adapter** is the second adapter that makes the seam real ([codebase-design](../.cursor/skills/codebase-design/SKILL.md): one adapter = hypothetical; two = real).
- Protocol code **never** imports `@libp2p/tcp` or `@libp2p/mdns`.

**Public API shape (proposed):**

```ts
createNode(infoHash, nodeSeed, userOpts?, strategies?, platformStack?)
// or
createNode({ infoHash, nodeSeed, config?, strategies?, platform: 'node' | 'browser' | Libp2pPlatformStack })
```

Prefer keeping `createNode` signature backward-compatible: optional 5th arg or options bag with default `createNodePlatformStack()`. Convenience wrappers:

- `createNodeNode(...)` → Node stack (explicit)
- `createBrowserNode(...)` → Browser stack (apps/web entry)

### D2 — Dependency seams in supporting packages (conditional exports)

| Package | Seam | Node adapter | Browser adapter |
|---------|------|--------------|-----------------|
| `@dechat/crypto` | Hash / UUID / CRC primitives | Keep noble-backed impl; **remove Node `crypto`/`zlib` from hot path** | Same pure JS / Web Crypto impl (one implementation if fully portable) |
| `@dechat/common` | `Logger` | File rotate + tslog (current) | Console (or tslog console-only) — **no** `rotating-file-stream` / `worker_threads` |
| `@dechat/core` replica store | `ReplicaStoreInterface` | `InMemory` + `LevelDB` | `InMemory` + **new** `IndexedDbReplicaStore` (or OPFS) |

Prefer **one portable crypto implementation** (noble) over dual crypto adapters if tests prove identical digests. Logger and store keep dual adapters.

Use package.json `exports` conditions:

```json
"exports": {
  ".": {
    "browser": "./dist/browser.js",
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

Tree-shake LevelDB / TCP / mDNS out of browser bundles.

### D3 — Hybrid topology is the product (not a compromise)

Per [`designing-p2p-systems`](../.cursor/skills/designing-p2p-systems/SKILL.md) and [`p2p-fundamentals`](../.cursor/skills/p2p-fundamentals/SKILL.md):

| Role | Runtime | Transports | Listens? |
|------|---------|------------|----------|
| Bootstrap / relay | Node (servers, Compose) | TCP (+ optional WS server) | Yes |
| Full peer | Node | TCP | Yes |
| Client peer | Browser | WS dial, WebRTC | Typically dial-only; may use circuit-relay |

Browser peers **must** know at least one bootstrap multiaddr. mDNS is **Node LAN only** (`enableMdns: false` in browser defaults).

### D4 — Config: illegal states unrepresentable

Per [`typescript`](../.cursor/skills/typescript/SKILL.md), avoid a loose bag that allows `listenAddrs: ['/ip4/0.0.0.0/tcp/0']` on browser.

Proposed discriminated config (or validated platform profile):

```ts
type PlatformProfile =
  | { kind: 'node'; listenAddrs: string[]; enableMdns?: boolean }
  | { kind: 'browser'; bootstrapPeers: string[]; enableMdns?: false; relay?: RelayClientConfig };
```

Defaults resolve per profile inside `resolveConfig` / platform stack factory — not by callers guessing multiaddrs.

### D5 — ADR + glossary before Phase 2 ships

Per [`domain-modeling`](../.cursor/skills/domain-modeling/SKILL.md):

- New ADR: `docs/adr/0004-platform-agnostic-libp2p-stack.md` (number may shift if another ADR lands first)
- Update `CONTEXT.md` with: **Platform stack**, **Bootstrap peer**, **Relay peer**, **Browser client peer**
- Do not duplicate this plan into the ADR — ADR records *decisions*; this file records *execution*

### D6 — Out of scope for v1 (explicit)

- Browser nodes inside Compose Tier-2 scenarios (BACKLOG already deferred)
- WebTransport-only production path (optional stretch after WS/WebRTC green)
- Replacing GossipSub / rewriting anti-entropy for browser
- Service Worker offline sync product features
- Polyfilling Node into the browser (we **reject** bundling `crypto`/`fs`/`level` polyfills as the strategy)

---

## Inventory: every concern classified

### A — Portable (leave alone; verify in browser bundle)

These modules already sit on libp2p / Uint8Array / in-memory structures. **No platform rewrite.**

| Area | Location | Why portable | Verification |
|------|----------|--------------|--------------|
| Peer auth handshake | `networking/PeerAuthenticator.ts` | Protocol over streams; Ed25519 via noble (after crypto port) | Unit tests + browser smoke |
| Peer registry / scorer | `PeerRegistry`, `SimplePeerScorer` | In-memory maps | Existing units |
| Dial queue / shouldDial logic | `DialQueue`, `shouldDial` (after hash helper swap) | Pure policy | Existing units |
| PEX | `PeerExchangeService` | Gossip + streams | Existing units |
| Peer discovery manager | `PeerDiscoveryManager` | Listens to libp2p events | Units; browser uses bootstrap events only |
| GossipSub propagation | `data-propagation/broadcast/` | libp2p pubsub | Node interop + browser smoke |
| Direct stream propagation | `data-propagation/direct/` | libp2p streams | Same |
| K-replica / topic replication | `data-replication/` | Content-addressed logic | Same |
| Replication protocol manager | `replication-protocol/` | Stream framing | Same |
| Anti-entropy + PrefixTrie | `data-convergence/` | Pure + stream exchange | Same |
| Schedulers / bandit | `data-convergence/scheduling/` | Pure JS math | Units |
| Wire serializers | `shared/serialization/` | Uint8Array CBOR/JSON | Units + browser |
| Framed stream codec | `framedStreamCodec.ts` | it-pipe | Units |
| In-memory store | `InMemoryReplicaStore` | Map | Units |
| Trie-backed decorator | `TrieBackedReplicaStore` | Wraps any store | Units |
| Metrics interfaces + noop/basic | `metrics/` | In-memory counters | Units |
| Strategy DI types | `types.ts` `DeChatStrategies` | Factories | Compile-time |

**Cleanup allowed without changing behaviour:**

- Replace `Buffer` in `PeerAuthenticator` with `Uint8Array` + base64url helpers (portable; not a new feature).
- Replace `process.env.NODE_ENV` checks with injected config flag or `import.meta.env`-safe helper behind a tiny env seam if needed.
- Replace `extends EventEmitter` in `InflightRequestTracker` with composition (`events` field) per [`p2p-design-patterns`](../.cursor/skills/p2p-design-patterns/SKILL.md) — use `eventemitter3` (browser-safe) if needed.

---

### B — Node seam (change for browser mode)

Each row: **current Node behaviour → browser-mode change → pattern**.

#### B1. Libp2p transports & listen addresses

| | |
|--|--|
| **Where** | `packages/core/src/node.ts`, `config/defaults.ts` (`listenAddrs`, `enableMdns`) |
| **Today (Node)** | `transports: [tcp()]`, listen `/ip4/0.0.0.0/tcp/0`, optional `@libp2p/mdns` |
| **Browser change** | `createBrowserPlatformStack()`: `@libp2p/websockets` and/or `@libp2p/webrtc` (+ optional `@libp2p/webtransport` later); **no** `@libp2p/tcp`; **no** mDNS; listenAddrs empty or WS-capable only; require `bootstrapPeers` |
| **Pattern** | **Abstract Factory** (`create*PlatformStack`) + **Strategy** injection into composition root; Adapter for libp2p transport factories |
| **Skills** | libp2p-core-patterns, libp2p-spec, codebase-design |

#### B2. Peer discovery set

| | |
|--|--|
| **Where** | `node.ts` peerDiscovery array; `PeerDiscoveryManager` (consumes events — portable) |
| **Today (Node)** | mDNS + bootstrap |
| **Browser change** | Bootstrap only (+ later relay-discovered peers via PEX after auth). Config default `enableMdns: false` for browser profile |
| **Pattern** | Same platform factory; discovery plugins are part of `Libp2pPlatformStack` |
| **Skills** | designing-p2p-systems, p2p-fundamentals |

#### B3. `@dechat/crypto` Node builtins

| | |
|--|--|
| **Where** | `packages/crypto/src/utils.ts` (`crypto.createHash`, `randomUUID`, `zlib.crc32`); `signatureVerification.ts` (`crypto`, `fs`) |
| **Today (Node)** | Node OpenSSL hashes; file-based key helpers in signatureVerification |
| **Browser change** | Hot path (`sha256`, `toHashBigInt`, `genEd25519KeyPair`, `generateIdProtocolPrefix`, `generateRandomUUID`) → `@noble/hashes` + `crypto.randomUUID()` / noble; **isolate** `signatureVerification.ts` behind Node-only export (not pulled into browser entry) |
| **Pattern** | Prefer **single portable module** for utils; **conditional exports** for Node-only signature helpers (Facade at package root) |
| **Skills** | typescript, tdd (digest golden vectors must match Node vs browser) |

#### B4. `@dechat/common` logger

| | |
|--|--|
| **Where** | `packages/common/src/logger.ts` |
| **Today (Node)** | tslog + rotating file stream + `worker_threads.threadId` + `process.env` |
| **Browser change** | Browser entry: console transport only; no file path; threadId omitted or `0`; env via safe getter |
| **Pattern** | **Adapter** at logger construction; package `exports.browser` |
| **Skills** | codebase-design (local-substitutable / ports) |

#### B5. Hash helper in `shouldDial`

| | |
|--|--|
| **Where** | `packages/core/src/networking/shouldDial.ts` (`import crypto from 'node:crypto'`) |
| **Today (Node)** | SHA-1 via Node crypto |
| **Browser change** | Call shared portable hash from `@dechat/crypto` (or `@noble/hashes/sha1`) — **same algorithm**, no behaviour change to election logic |
| **Pattern** | Remove Node import; depend on portable crypto facade |
| **Skills** | typescript |

#### B6. `EventEmitter` / `Buffer` / `process.env` leaks in core

| | |
|--|--|
| **Where** | `InflightRequestTracker.ts`, `PeerAuthenticator.ts`, `PeerRegistry.ts` |
| **Today (Node)** | Node `events`, Node `Buffer`, `process.env` |
| **Browser change** | `eventemitter3` or composed emitter; Uint8Array base64url; config/env helper |
| **Pattern** | Dependency inversion — core depends on portable primitives only |
| **Skills** | p2p-design-patterns (compose events), typescript |

#### B7. Replica store factory entrypoints

| | |
|--|--|
| **Where** | `replica-store/ReplicaStoreInterface.ts` `replicaStore('LEVEL_DB' \| 'IN_MEMORY')`; `index.ts` re-exports LevelDB |
| **Today (Node)** | Importing package pulls LevelDB |
| **Browser change** | Browser export map must **not** static-import `level`; LevelDB only via `@dechat/core/node` or dynamic Node path; browser uses `IN_MEMORY` or IndexedDB factory |
| **Pattern** | **Conditional exports** + split entrypoints (`@dechat/core`, `@dechat/core/node`, `@dechat/core/browser`) |
| **Skills** | codebase-design, typescript |

#### B8. Defaults & validation

| | |
|--|--|
| **Where** | `config/defaults.ts`, `config/types.ts` |
| **Today (Node)** | TCP listen defaults; LevelDB path; mDNS on |
| **Browser change** | Browser profile defaults; validate bootstrap non-empty; reject TCP listen addrs; reject LEVEL_DB store type unless Node entry |
| **Pattern** | Discriminated unions + validation rules per profile ([typescript](../.cursor/skills/typescript/SKILL.md) illegal states) |

---

### C — New implementations for browser mode

These do not exist today and must be added.

#### C1. `createBrowserPlatformStack()` (+ deps)

| | |
|--|--|
| **Add** | `packages/core/src/platform/createBrowserPlatformStack.ts` (name TBD) |
| **Deps (new)** | `@libp2p/websockets`, `@libp2p/webrtc` (confirm versions compatible with current `libp2p@^2.5`); optional `@libp2p/circuit-relay-v2` client |
| **Responsibility** | Return `Libp2pPlatformStack` for browser; document required bootstrap multiaddrs |
| **Pattern** | Abstract Factory |
| **Skills** | libp2p-spec, libp2p-core-patterns |

#### C2. Circuit relay / server assist (hybrid mesh)

| | |
|--|--|
| **Add** | Node-side relay capability in platform stack (or documented external relay); browser `relayClient` service wiring |
| **Why** | Browser↔browser and browser behind NAT need relay ([p2p-fundamentals](../.cursor/skills/p2p-fundamentals/SKILL.md)) |
| **v1 minimum** | Browser dials **Node** peer that listens TCP (and optionally WS). Browser↔browser can be Phase 1.5 |
| **Pattern** | Separate **roles** in topology (bootstrap vs relay vs client) — domain terms via domain-modeling |
| **Skills** | designing-p2p-systems, libp2p-spec |

#### C3. `IndexedDbReplicaStore` (or OPFS)

| | |
|--|--|
| **Add** | `packages/core/src/replica-store/IndexedDbReplicaStore.ts` implementing `ReplicaStoreInterface` |
| **Why** | LevelDB is Node/fs; browsers need durable CAS for reload |
| **v1 optional** | MVP can ship with `InMemoryReplicaStore` only; IndexedDB in Phase 4 |
| **Pattern** | **Adapter** on existing `ReplicaStoreInterface` seam (already real — InMemory + LevelDB) |
| **Skills** | codebase-design (third adapter on existing seam), tdd |

#### C4. Browser package entry + bundler contract

| | |
|--|--|
| **Add** | `packages/core/src/browser.ts` (or `platform/browser.ts`) exporting `createBrowserNode`; package exports; README section |
| **Add** | Smoke app or Vitest browser project under `packages/core/tests/browser/` or `apps/web` integration |
| **Pattern** | Facade entrypoints per platform |
| **Skills** | typescript, tdd |

#### C5. Browser ↔ Node interop test harness

| | |
|--|--|
| **Add** | Minimal hybrid test: Node worker/process (existing `configureNode` / `nodeRunner`) + browser peer (Playwright or Vitest browser mode) |
| **Assert** | Auth success → registry → one content hash converges |
| **Non-goal** | Full 50-node nightly in browser |
| **Pattern** | Reuse `nodeRunner` command surface where possible (same lesson as Compose Tier 2 shared runner) |
| **Skills** | libp2p-core-patterns (interop teardown discipline), tdd |

#### C6. Portable base64url / bytes helpers (if not already)

| | |
|--|--|
| **Add** | Small `@dechat/crypto` or `core/shared` helpers to replace `Buffer.from(..., 'base64url')` |
| **Pattern** | Pure functions; single implementation |
| **Skills** | typescript |

---

## Design patterns (how we keep this clean)

| Pattern | Applied to | Avoid |
|---------|------------|-------|
| **Deep module + small interface** | `Libp2pPlatformStack`, `ReplicaStoreInterface`, crypto utils, logger | Leaking transport types into replication |
| **Abstract Factory** | `createNodePlatformStack` / `createBrowserPlatformStack` | Call-site `if (browser) tcp()` |
| **Strategy (existing)** | `DeChatStrategies` unchanged for broadcast/store/replication | Forking strategies per platform |
| **Adapter** | Logger, IndexedDB store, libp2p transports | Polyfill-everything bundler hacks |
| **Facade** | `createBrowserNode` / `createNodeNode` | Teaching every app about libp2p transport arrays |
| **Discriminated unions** | Platform config profiles | Optional fields that allow invalid combos |
| **Conditional exports** | Package entrypoints | Runtime `typeof window` scattered in hot paths |
| **Composition over inheritance** | Inflight tracker events | `extends EventEmitter` from Node `events` |
| **Layered networking** ([p2p-design-patterns](../.cursor/skills/p2p-design-patterns/SKILL.md)) | Discovery / session / sub-protocol stay separate | Discovery importing TCP |

**Seam discipline checklist (from codebase-design):**

1. Protocols depend on libp2p **interfaces**, not Node transports.  
2. Two adapters before merge of the platform seam (Node + Browser).  
3. Interface is the test surface — unit-test stacks by faking `Libp2pPlatformStack` where useful.  
4. Deletion test: if we delete `Libp2pPlatformStack`, complexity must reappear in `createNode` — proving the seam earns its keep.

---

## Target module layout (proposed)

```
packages/core/src/
├── node.ts                         # createNode — uses platform stack (default Node)
├── platform/
│   ├── types.ts                    # Libp2pPlatformStack, PlatformKind
│   ├── createNodePlatformStack.ts  # B — Node adapter (today’s wiring extracted)
│   └── createBrowserPlatformStack.ts # C — Browser adapter
├── browser.ts                      # Facade: createBrowserNode
├── replica-store/
│   ├── InMemoryReplicaStore.ts     # A
│   ├── LevelDbReplicaStore.ts      # B — Node-only export
│   └── IndexedDbReplicaStore.ts    # C — Browser durable
└── ...                             # A — unchanged protocols

packages/crypto/
├── index.ts                        # Portable exports only
├── node.ts                         # Optional: signatureVerification / fs helpers
└── src/utils.ts                    # Noble-based (no node:crypto)

packages/common/
├── index.ts
├── src/logger.node.ts
└── src/logger.browser.ts
```

Exact filenames can shift during implementation; the **seam names** should not.

---

## Phased execution plan

### Phase 0 — Approve design + ADR skeleton (0.5–1 day)

**Skills:** domain-modeling, codebase-design, designing-p2p-systems  

- [x] Approve D1–D6 in this doc  
- [x] Draft ADR-0004 (Accepted / Proposed)  
- [x] Add glossary terms to `CONTEXT.md`  
- [x] Confirm libp2p v2-compatible browser transport package versions (`@libp2p/websockets@^9` with `libp2p@^2.5`; avoid websockets 10+/webrtc 6+ which target libp2p v3)

**Done when:** Written approval on D1 API shape and v1 topology (Node bootstrap required).

---

### Phase 1 — Untangle Node-only deps (portable baseline) (3–5 days)

**Skills:** typescript, tdd, codebase-design  

**Work:**

1. [x] Port `@dechat/crypto` utils to `@noble/hashes` (+ CRC32 portable); golden-vector tests for sha256 / xor inputs used by replication.  
2. [x] Split `@dechat/crypto` exports so `signatureVerification` is Node-only.  
3. [x] Split `@dechat/common` logger (browser console adapter).  
4. [x] Remove `node:crypto` from `shouldDial`; remove `Buffer` / Node `events` / unsafe `process.env` from core src.  
5. [x] Ensure `cbor-x` / deps resolve in a browser bundler (Vite/esbuild smoke import).  

**Done when:** `import { createNode }` still works on Node; a Vite/esbuild browser build of crypto+common+core **protocol modules** does not require Node polyfills (createNode may still fail until Phase 2 — acceptable if tcp import is behind Node entry). Prefer: core browser entry does not import tcp/level yet.

**Tests:** Unit suite green; new crypto golden tests; logger browser unit (console mock).

---

### Phase 2 — Extract Node platform stack + inject into `createNode` (3–5 days)

**Skills:** libp2p-core-patterns, codebase-design, typescript  

**Work:**

1. [x] Extract today’s `createLibp2p({ transports: [tcp()], ...})` wiring into `createNodePlatformStack()`.  
2. [x] `createNode` accepts optional stack; default = Node stack (zero behaviour change).  
3. [x] Move `@libp2p/tcp` / `@libp2p/mdns` imports into Node platform module only.  
4. [x] Split package exports so default/browser entry does not load LevelDB/tcp.  
5. [x] Regression: all existing unit + interop startup/data-sync still green.  

**Done when:** Node behaviour identical; `createNode` no longer hardcodes tcp in `node.ts`.

---

### Phase 3 — Browser platform stack + hybrid smoke (5–10 days)

**Skills:** libp2p-spec, designing-p2p-systems, p2p-fundamentals, tdd, libp2p-core-patterns  

**Work:**

1. [x] Implement `createBrowserPlatformStack()` (WebSockets first; WebRTC as needed).  
2. [x] Implement `createBrowserNode` facade + browser defaults/validation.  
3. [x] Stand up Node bootstrap peer (existing examples or thin script) with published multiaddr.  
4. [x] Browser smoke: start → dial bootstrap → auth → register peer.  
5. [x] Extend smoke: produce one content hash → browser or Node observes via replication/anti-entropy.  
6. [x] Document required multiaddr formats for apps/web.  

**Done when:** Automated or scripted hybrid smoke is green in CI (or documented local + CI job).

**Stretch in Phase 3:** circuit-relay for browser↔browser. *(deferred)*

---

### Phase 4 — Persistence + packaging polish (3–5 days)

**Skills:** codebase-design, typescript, tdd  

**Work:**

1. [x] `IndexedDbReplicaStore` behind `ReplicaStoreInterface`.  
2. [x] Boot lock: `replicaStore.init()` before network start (existing rule) verified in browser.  
3. [x] README: platform matrix, listen/bootstrap rules, export map.  
4. Optional: OPFS experiment deferred unless IndexedDB insufficient.  

**Done when:** Browser reload retains hashes across refresh in smoke test. *(IndexedDB implemented; reload smoke deferred to apps/web)*

---

### Phase 5 — Hardening & docs (2–4 days)

**Skills:** domain-modeling, diagnosing-bugs (as needed), tdd  

**Work:**

1. [x] ADR Accepted + CONTEXT.md finalized.  
2. [x] Update `.cursor/skills/libp2p-core-patterns` package map for `platform/`.  
3. [x] Flake budget for hybrid smoke; quarantine if needed.  
4. Explicit backlog items for Compose WebRTC (still separate from this task).  

**Done when:** Plan checklist complete; Node CI unchanged; hybrid smoke stable.

---

## PR slicing (suggested)

| PR | Scope | Risk |
|----|-------|------|
| **P0** | ADR + CONTEXT glossary only | None |
| **P1** | crypto + common portable / dual logger | Medium — digest must match |
| **P2** | Extract Node `Libp2pPlatformStack`; createNode injection; export map | Medium — interop regression |
| **P3a** | Browser stack + WS dial + auth smoke | High — new transport |
| **P3b** | Replication round-trip hybrid | High |
| **P4** | IndexedDB store | Medium |
| **P5** | Docs + skill updates | Low |

Do not combine P1+P3. Keep Node green after every merge.

---

## Acceptance criteria (v1)

1. **Node parity:** Existing `@dechat/core` unit tests and `test:int:startup` / `test:int:data-sync` pass without behavioural flags.  
2. **No polyfill strategy:** Browser build does not bundle `level`, `@libp2p/tcp`, or Node `fs`/`crypto` polyfills for the happy path.  
3. **Seam exists:** `node.ts` does not import tcp/mdns; platform adapters own those imports.  
4. **Browser node:** `createBrowserNode` (or equivalent) dials a Node bootstrap, completes `PeerAuthenticator`, appears in `PeerRegistry`.  
5. **Data path:** At least one content hash is shared Node↔browser via existing replication or anti-entropy strategies.  
6. **Docs:** ADR-0004 Accepted; README platform section; skills list in this file followed in PRs.  
7. **Auth-first invariant unchanged:** No peer in registry before auth ([.cursorrules](../.cursorrules) / libp2p-core-patterns).

---

## Effort estimate

| Phase | Eng-days |
|-------|----------|
| 0 Approve + ADR | 0.5–1 |
| 1 Untangle deps | 3–5 |
| 2 Extract Node stack | 3–5 |
| 3 Browser stack + hybrid smoke | 5–10 |
| 4 IndexedDB + packaging | 3–5 |
| 5 Hardening | 2–4 |
| **Total** | **~17–30** |

MVP path (Phases 0–3, in-memory store only): **~12–21 eng-days**.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| libp2p v2 browser transport version skew | Pin compatible set in Phase 0; spike one-day createLibp2p in Vite before P3 |
| GossipSub mesh slow/flaky for single browser peer | Longer stabilize; bootstrap + direct stream for smoke assert |
| Digest mismatch after noble migration | Golden vectors from current Node outputs before swap |
| Bundle accidentally includes LevelDB | CI check: browser build fail if `level` appears in metafile |
| Scope creep into Compose WebRTC | Keep in D6 / backlog; do not block v1 |
| `cbor-x` or bloom-filters edge cases in browser | Early Phase 1 bundler smoke |

---

## Execution checklist (copy into PR notes)

### Classification reminder

- [ ] **A — Portable:** no protocol rewrites  
- [ ] **B — Seams:** Node adapter preserves behaviour; Browser adapter additive  
- [ ] **C — New:** browser stack, (relay), IndexedDB, hybrid test, facades  

### Skills applied (tick per PR)

- [ ] codebase-design  
- [ ] designing-p2p-systems  
- [ ] libp2p-core-patterns  
- [ ] libp2p-spec  
- [ ] p2p-design-patterns / p2p-fundamentals (as needed)  
- [ ] typescript  
- [ ] domain-modeling (ADR/CONTEXT)  
- [ ] tdd  

### Do not start until

- [ ] D1–D6 approved  
- [ ] Transport package versions spiked  

---

## Appendix A — Quick reference: file → bucket

| File / package | Bucket |
|----------------|--------|
| `networking/*` (except shouldDial Node import, Buffer in auth) | A (+ B cleanup) |
| `data-propagation/*` | A |
| `data-replication/*` | A |
| `data-convergence/*` | A |
| `shared/serialization/*` | A |
| `metrics/*` | A |
| `InMemoryReplicaStore` / `TrieBackedReplicaStore` | A |
| `node.ts` transport wiring | B → extract |
| `config/defaults` TCP/mDNS defaults | B |
| `LevelDbReplicaStore` | B (Node-only export) |
| `shouldDial` node:crypto | B |
| `InflightRequestTracker` events | B |
| `@dechat/crypto` utils | B → portable |
| `@dechat/crypto` signatureVerification | B Node-only |
| `@dechat/common` logger | B dual adapter |
| `createBrowserPlatformStack` | C |
| Relay client wiring | C |
| `IndexedDbReplicaStore` | C |
| Browser entry + hybrid test | C |

## Appendix B — Mapping to prior audit canvas

The canvas [core-browser-portability](file:///Users/ahmedabdulrahman/.cursor/projects/Users-ahmedabdulrahman-Documents-Programs-git-repos-de-chat/canvases/core-browser-portability.canvas.tsx) remains the visual summary. **This file is the execution source of truth.** If they diverge, update this plan first.
