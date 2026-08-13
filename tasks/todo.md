# Active plans

## Chat application readiness (pre-UI)

**Spec:** [tasks/chat-application-readiness.md](chat-application-readiness.md)  
**Status:** Implementing (decisions accepted 2026-08-13)  
**Intent:** Land core prerequisites + `@dechat/chat` deep module **before** any React UI.

### Locked decisions

1. `@dechat/chat` + `ChatClient`
2. Room scope = **layer on existing strategies** (ADR-0005), not a rewrite
3. Hybrid + plaintext first
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
| 5–7 | Identity/membership/E2EE, bootstrap, CI | Later |

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
