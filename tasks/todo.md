# Active plans

## P0 — Mesh identity isolation (do before more chat/UI)

**Backlog:** [BACKLOG.md Task 0.1](../BACKLOG.md)  
**Status:** Open — next  
**Why:** `infoHash` is meant to partition *this* DeChat mesh from other networks. Today it only changes Identify `protocolPrefix`; auth `networkId`, PEX, and replication/room topics stay global. Two DeChat deployments can still auth and gossip. Room join must **not** use `infoHash` (open room = verified peer + `joinRoom`).

---

## Chat application readiness (pre-UI)

**Spec:** [tasks/chat-application-readiness.md](chat-application-readiness.md)  
**Status:** Implementing (decisions accepted 2026-08-13)  
**Intent:** Land core prerequisites + `@dechat/chat` deep module **before** any React UI.

### Locked decisions

1. `@dechat/chat` + `ChatClient`
2. Room scope = **layer on existing strategies** (ADR-0005), not a rewrite
3. Hybrid + **body E2EE** (ADR-0006); capability-closed rooms later
4. Auth PeerId binding early
5. Open rooms for v1
6. No temporary single-room client — room layer first

### Phase order

| Phase | Focus | Status |
|-------|--------|--------|
| 0 | Glossary + ADR-0005 + backlog | Done |
| 1 | `@dechat/core/browser` strategy exports | Done |
| 2 | Auth: bind presented key ↔ libp2p PeerId | Done |
| 3 | Room-scoped replication layer | Done |
| 4 | `@dechat/chat` + two-node ChatClient interop | Done |
| 5 | Identity + open-room membership + body E2EE (5a–5c) | Done |
| 6 | Bootstrap recipe + chat-interop CI | Done |
| 7 | Persistence & remaining CI gates | Later |

### Phase 5 scope (locked decisions)

**5a — Identity UX (this sprint)**
- Portable seed generate / parse / export in `@dechat/chat` (`identity/`).
- `peerIdFromNodeSeed` in `@dechat/core` so ChatClient PeerId matches createNode derivation without starting a node.
- Optional unsigned `displayName` on chat envelopes; projected as `untrustedDisplayName` (PeerId remains identity).
- Document: seed restores PeerId; IndexedDB holds replicas not the seed; no vault / E2EE claims.

**5b — Open rooms (this sprint, no capability ADR)**
- Any **verified peer** on this mesh may `joinRoom` (no invite). Network ID / `infoHash` is mesh partition, not a room ACL.
- ChatClient exposes `isMember`; send still requires join (room-scope produce gate).
- Isolation already proven by two-node interop (Bob never stores `secret-room`).

**5c — E2EE (this sprint)**
- AES-256-GCM on message bodies; Ed25519 over ciphertext + roomId + messageId + epoch (ADR-0006).
- Room keys in ChatClient memory; distributed to verified peers on `/deChat/v1/protocol/room-key`.
- `leaveRoom` discards keys; `rotateRoomKey` bumps epoch. Replica store must not contain plaintext.

---

## Closed

### Platform-agnostic `@dechat/core` (Node + Browser) — closed (v1)

**Spec:** [tasks/platform-agnostic-core.md](platform-agnostic-core.md)  
**Status:** Closed — [PR #46](https://github.com/Ahmed-Abdul-Rahman/de-chat/pull/46) merged to `develop` on 2026-07-19.

Follow-ups tracked as [BACKLOG Task 6.2](../BACKLOG.md) (real-browser smoke, IndexedDB reload, circuit-relay / WebRTC, CI bundle guard).

### Tier 2 Compose Interop — closed (v1)

**Spec:** [tasks/tier2-compose-interop.md](tier2-compose-interop.md)  
**Status:** Closed — PR A–D merged (#42–#45) on 2026-07-19.

Follow-ups: watch Compose Interop Nightly; optional Compose PR-gate after flake &lt; 5%.

### Prior closed work

- Adaptive anti-entropy scheduling (Tier 1) — see related tier1 docs.
