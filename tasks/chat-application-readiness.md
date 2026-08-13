# Chat Application Readiness (pre-UI)

**Status:** Accepted — implementing  
**Goal:** Make `@dechat/core` + a new application package ready so a React chat app can be a thin adapter, not a P2P composition root.  
**Non-goal this plan:** Building `apps/web` UI / React components (explicitly deferred until phases below land).

Related: ADR-0001 (topic replication), ADR-0002 (TOMBSTONE), ADR-0004 (platform stack), BACKLOG Task 6.2 (browser hardening).

---

## Package name recommendation

| Candidate | Verdict |
|-----------|---------|
| `chat-utility` | Reject — sounds like helpers, not a product boundary |
| `chat-client` | Reject — implies UI/browser-only; Node bootstrap peers also need the same domain API |
| **`@dechat/chat`** | **Choose** — matches glossary (“Chat room”, “Encrypted chat”); one package for Node + browser chat domain |
| `@dechat/messaging` | Keep in reserve if we later split non-chat content classes |

**Public surface (deep module):**

```typescript
createChatClient(options) → ChatClient

interface ChatClient {
  readonly peerId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  joinRoom(roomId: RoomId): Promise<void>;
  leaveRoom(roomId: RoomId): Promise<void>;
  sendMessage(roomId: RoomId, body: MessageBody): Promise<ContentHash>;
  getHistory(roomId: RoomId): Promise<readonly ChatMessageView[]>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
}
```

Callers (React, CLI, tests) never touch `DeChatStrategies`, GossipSub, or replica stores directly.

Layout:

```
packages/chat/
  package.json          # @dechat/chat — conditional browser/node exports
  src/
    createChatClient.ts # composition: wires core strategies + chat domain
    ChatClient.ts       # deep interface + impl
    domain/             # RoomId, ChatMessage, Tombstone, events
    projection/         # history from CAS + tombstones
    identity/           # seed → identity (portable)
    defaults/           # recommended DeChatStrategies for chat
  tests/unit/
```

Depends on `@dechat/core`, `@dechat/crypto`, `@dechat/common`. Does **not** depend on React.

---

## Decision gates — accepted 2026-08-13

1. Package name **`@dechat/chat`** with `createChatClient` / `ChatClient` — accepted.
2. Room scoping in **`@dechat/core` as a layer on top of existing strategies** (ADR-0005), not a rewrite of topic-based / K-replica — accepted.
3. First milestone **hybrid + plaintext** (E2EE later) — accepted.
4. **Auth PeerId binding** early — accepted.
5. Membership v1: **open rooms** (anyone on `networkId`); capability/invite rooms later.
6. **No temporary single-room client** — wait for the room-scope layer before `@dechat/chat`.

---

## Phase map (ordered)

```
Phase 0  Decisions + glossary/ADR stubs
Phase 1  Core browser export completeness + verification seams
Phase 2  Auth trust hardening (core)
Phase 3  Room-scoped replication (core) ← largest correctness work
Phase 4  @dechat/chat deep module
Phase 5  Identity + membership foundation (chat + core hooks)
Phase 6  Networking productization (bootstrap/WSS/docs; relay stretch)
Phase 7  Persistence + CI hardening (pre-UI gate)
───────── UI allowed after Phase 4 minimum; production claims after 5–7 ─────────
```

---

## Phase 0 — Domain & decisions

- [x] Lock package name + `ChatClient` interface shape (above).
- [x] Update `CONTEXT.md` Application section: **Chat client**, **Room ID**, **Chat message**, **Message projection**, **Membership** (glossary only).
- [x] Draft ADR-0005: *Room-scoped replication and anti-entropy* (problem: global replication topic/store today vs ADR-0001 intent).
- [x] Add BACKLOG Category 7 (or extend 6) pointing at this plan.
- [x] Write active entry in `tasks/todo.md`.

**Done when:** Decisions 1–4 approved; ADR-0005 status `proposed` or `accepted`.

---

## Phase 1 — Core browser interface completeness

**Why first:** Without this, `@dechat/chat` cannot wire strategies from a public browser entry.

### Work

1. **Expand `@dechat/core/browser` exports** to include portable strategy factories used by hybrid smoke:
   - `GossipSubPropagation` / factory
   - `DirectStreamPropagation` / factory
   - `Sha256ContentHashStrategy`
   - `ReplicationMessageProtocolManager` / factory
   - `topicBasedContentHashReplication`
   - `antiEntropyManager`, `antiEntropyNetworkExchangeEngine`
   - related types (`PropagatedMessage`, interfaces)
2. **Do not** export `createNode`, `createNodePlatformStack`, LevelDB, or TCP/mDNS from the browser entry.
3. Optional: add `@dechat/core/strategies` subpath if browser entry would otherwise bloat — only if export map stays clean.
4. **Preset factory** in core or chat: `chatStrategies()` / `fullTopicReplicationStrategies()` so callers don’t hand-roll DI.
5. Unit test: importing `@dechat/core/browser` graph must not resolve `@libp2p/tcp` / `level` (static import check or esbuild metafile — can share Phase 7 guard).

**Done when:** Hybrid smoke can be rewritten to import strategies only from public package surfaces (no `../../src/...`).

**Effort:** ~0.5–1 day.

---

## Phase 2 — Authentication trust hardening (core)

**Why before chat membership:** Today auth verifies an Ed25519 signature over a nonce but does not clearly bind the presented pubkey to `connection.remotePeer` / libp2p identity. Registry trust rests on that handshake.

### Work

1. **Bind auth identity to PeerId**
   - Derive expected PeerId from presented pubkey (or require message fields that prove peerId ownership).
   - Reject if derived id ≠ `connection.remotePeer` / dial target.
2. **Document trust model** in `docs/core/` or short ADR note:
   - Auth = “this libp2p peer controls this key” (network admission).
   - Membership / E2EE = separate (Phase 5).
3. Unit tests: forged pubkey with valid signature over nonce but wrong PeerId → fail; matching PeerId → succeed.
4. Re-run narrow interop + hybrid smoke.

**Done when:** Unauthenticated or identity-mismatched peers cannot enter `PeerRegistry`.

**Effort:** ~1–2 days.

**Out of scope here:** Room ACLs, invites, bans (Phase 5).

---

## Phase 3 — Room-scoped replication (core) — critical

**Why before a real multi-room `ChatClient`:** ADR-0001 intends per-room full replication. Implementation today:

- `joinTopic(topic)` only attaches a GossipSub handler.
- `announceToNetwork` always publishes on **one** global `config.strategies.replication.topic`.
- One global replica store + prefix trie → anti-entropy syncs **all** hashes, not room history.
- `DataReplicationInterface` lacks `joinTopic` / `leaveTopic`.

### Design targets (ADR-0005)

1. **Room ID → topic mapping** (deterministic, namespaced), e.g. `/deChat/v1/room/<roomId>`.
2. **Replication control messages carry `roomId`** (or room topic) on ANNOUNCE / REQUEST / CONTENT / ERROR.
3. **Peers only pull/announce for rooms they have joined** (`shouldReplicate` + membership set).
4. **Storage indexing:** either
   - **A (preferred for v1):** single CAS store + secondary index `roomId → Set<hash>`, trie keyed per room or partitioned snapshots; or
   - **B:** separate store/trie per room (heavier, clearer isolation).
5. **Anti-entropy sessions are room-scoped** (or sync only indexes for joined rooms).
6. **Surface on interface:**

```typescript
interface DataReplicationInterface {
  // existing...
  joinTopic?(topic: string): Promise<void>;
  leaveTopic?(topic: string): Promise<void>;
}
```

   Prefer renaming to `joinRoom` / `leaveRoom` at chat layer; core may keep topic strings.

7. **Observability for app layer:** emit content-applied events (hash, roomId, bytes or decoded envelope) so `@dechat/chat` need not poll the store.

### Work breakdown

| Slice | Work | Effort |
|-------|------|--------|
| 3a | Envelope + wire types include `roomId`; protocol manager routes by room | 2–3d |
| 3b | Membership set in `TopicBasedContentReplication`; gate announce/pull | 1–2d |
| 3c | Store index or per-room trie; anti-entropy room filter | 3–5d |
| 3d | Interface + events; unit + interop (2 rooms, peer joins only A) | 2–3d |

**Done when:** Peer joining room A never stores room B content; anti-entropy for A does not require B’s hashes; interop test green.

**Effort:** ~1.5–2.5 weeks (largest phase).

**Sequencing note:** Phase 4 can start a **single-room** `ChatClient` against today’s global scope for API shape, but multi-room APIs must wait for Phase 3 — prefer finishing 3a–3b before exposing `joinRoom` publicly.

---

## Phase 4 — `@dechat/chat` deep module

### Interface (invariants)

- `start()` → core node start (boot lock, strategies).
- `stop()` → reverse lifecycle; unsubscribe all rooms; no leaked timers.
- `joinRoom` / `leaveRoom` → core replication membership.
- `sendMessage` → validate → serialize envelope → `onLocalDataProduced` (or room-aware API).
- `getHistory` → project CAS + tombstones → ordered `ChatMessageView[]`.
- `subscribe` → local produce + remote apply events (and later membership).

### Domain types (initial)

```typescript
type RoomId = string; // opaque; validate length/charset in chat package

interface ChatMessageEnvelope {
  type: 'chat_message';
  roomId: RoomId;
  messageId: string;      // client UUID
  senderPeerId: string;
  timestamp: number;      // sender wall clock; display order = timestamp then messageId
  body: { text: string }; // v1 plaintext
}

interface TombstoneEnvelope {
  type: 'tombstone';
  roomId: RoomId;
  targetHash: ContentHash;
  senderPeerId: string;
  timestamp: number;
}
```

Projection: replay room hashes chronologically; hide tombstoned targets (ADR-0002).

### Wiring hidden behind the seam

- Platform: `createBrowserNode` vs `createNode` via options (`platform: 'browser' | 'node'`).
- Default strategies: topic-based replication + IndexedDB/InMemory/LevelDB by platform.
- Serializer: reuse core wire format (CBOR default).
- Bootstrap peers / listen addrs from options.

### Tests

- Unit: projection with messages + tombstones.
- Unit: join/leave membership bookkeeping (mocked core).
- Integration (Node): two `ChatClient`s, one room, message converges — `packages/chat/tests/interop/twoNodeChatClient.int.test.ts` (`yarn test:int:chat`).
- After Phase 3: two rooms isolation test — same file (Bob never joined `secret-room`).

**Done when:** Node-only integration proves send → remote history without any React; public README for `@dechat/chat` documents hybrid bootstrap requirement.

**Effort:** ~1–1.5 weeks (can overlap late Phase 3).

---

## Phase 5 — Identity, membership, security foundation

Split deliberately: **network auth** (Phase 2) ≠ **room membership** ≠ **E2EE**.

### 5a — Identity UX foundation (no E2EE yet)

- [ ] Portable seed generate / import / export helpers in `@dechat/chat` or `@dechat/crypto`.
- [ ] Stable display of `peerId`; optional display-name as unsigned gossip metadata (mark untrusted).
- [ ] Document: seed = root of identity; browser storage guidance (IndexedDB vs memory) — no “secure vault” claim yet.

### 5b — Room membership (authorization)

- [ ] Define membership model for v1:
  - **Open rooms** (anyone on networkId can join) — OK for first demo; or
  - **Capability rooms** (invite token / signed membership cert) — preferred before any “private room” marketing.
- [ ] Gate: only members may `joinRoom` / send / pull room content (enforced in replication `shouldReplicate` + chat layer).
- [ ] ADR if capability model chosen (hard to reverse).

### 5c — E2EE (after membership)

- [ ] Room key lifecycle: create, distribute to members, rotate on leave.
- [ ] Encrypt `body` only; keep envelope metadata needed for routing/replication as needed for mesh (trade-off ADR).
- [ ] Sender signature over ciphertext + roomId + messageId.
- [ ] Never claim “encrypted chat” in UI until this phase ships + tests.

**Done when (5a):** seed/identity story documented + tested.  
**Done when (5b):** non-member cannot obtain room payloads in interop.  
**Done when (5c):** ciphertext-only in replica store for E2EE rooms.

**Effort:** 5a ~2d; 5b ~1–2w; 5c ~2–4w.

---

## Phase 6 — Networking productization

Aligned with ADR-0004 hybrid topology + BACKLOG 6.2 stretch.

### 6a — Required for any browser chat (pre-UI still OK as tooling)

- [ ] **Bootstrap peer recipe:** small Node entry (`packages/chat` or `packages/examples` / future `apps/bootstrap`) that listens TCP+WS, prints multiaddr for clients.
- [ ] Config schema: `bootstrapPeers: string[]`, `networkId` / `infoHash`, `nodeSeed`.
- [ ] Docs: local hybrid loop (Node bootstrap + two browser clients later).
- [ ] Production note: **WSS** (TLS termination) for HTTPS pages — document reverse-proxy pattern; optional helper later.

### 6b — Stretch (after chat works on LAN/localhost)

- [ ] Circuit-relay client on browser stack (`Libp2pPlatformStack.services`).
- [ ] WebRTC transport when libp2p major aligns.
- [ ] Compose / interop scenario: two browser peers via relay.
- [ ] Explicitly **out of critical path** for first React wiring.

**Done when (6a):** New contributor can start bootstrap + two Node `ChatClient`s with written steps.  
**Done when (6b):** Documented path for NAT / browser↔browser.

**Effort:** 6a ~2–3d; 6b ~1–2w+.

---

## Phase 7 — Persistence & CI gates (pre-UI merge bar)

From BACKLOG 6.2, reframed as readiness for chat — still **no React app required**.

- [ ] IndexedDB reload smoke (put hash → reopen → has).
- [ ] Hybrid smoke in CI (`test:int:hybrid-browser-stack`).
- [ ] Bundle metafile guard: browser entry must not include `level`, `@libp2p/tcp`, `fs`, Node `crypto`.
- [ ] Real-browser smoke (Playwright): `createBrowserNode` or `createChatClient` + auth + registry (+ one message after Phase 4).
- [ ] Chat interop job: two clients, one room, converge.

**Done when:** CI fails if browser graph regresses to Node-only deps; chat message round-trip covered without UI.

**Effort:** ~1 week interleaved with Phases 4–6.

---

## Suggested sequencing for “not rushing UI”

| Sprint | Focus | UI? |
|--------|-------|-----|
| S1 | Phase 0 + 1 + 2 | No |
| S2–S3 | Phase 3 (room scope) | No |
| S4 | Phase 4 (`@dechat/chat`) + 6a bootstrap tool | No |
| S5 | Phase 7 CI + 5a identity | No |
| S6+ | Phase 5b/5c + 6b as needed | Still optional |
| After S4 min | Thin React adapter allowed for manual play | Yes, thin |

**Earliest safe UI spike:** after Phase 4 + 6a (single room, hybrid, plaintext).  
**Earliest “real product” claims:** after Phase 3 + 5b (+ 5c if advertising encryption).

---

## Explicitly deferred (do not block readiness plan)

- React / `apps/web` layout, hooks, design system
- Typing indicators, read receipts, attachments, media streaming
- Compaction / GC of tombstoned payloads
- Global message ordering / causal CRDTs beyond timestamp+id projection
- Blockchain package integration

---

## Open questions

Resolved 2026-08-13 — see Decision gates.

---

## Acceptance bar for “ready for UI work”

- [ ] `@dechat/core/browser` exports full portable strategy set
- [ ] Auth binds key ↔ PeerId
- [x] Room-scoped replication + isolation interop green (or explicitly waived for single-room-only UI spike)
- [x] `@dechat/chat` with `createChatClient` documented and Node-tested
- [ ] Bootstrap peer recipe works locally
- [ ] IndexedDB + hybrid (+ preferably Playwright) CI green
- [ ] Security claims match shipped phases (no E2EE labeling until 5c)
