# Active plans

## Platform-agnostic `@dechat/core` (Node + Browser) — READY FOR REVIEW

**Spec:** [tasks/platform-agnostic-core.md](platform-agnostic-core.md)  
**Branch:** `feature/platform-agnostic-core`  
**Status:** Phases 0–5 implemented on feature branch (WebRTC/circuit-relay + IndexedDB reload smoke deferred).

### Done

- [x] Phase 0: ADR-0004 + CONTEXT glossary
- [x] Phase 1: portable crypto + dual logger + core Node-leak cleanup
- [x] Phase 2: `Libp2pPlatformStack` + conditional exports
- [x] Phase 3: browser stack + hybrid smoke (Node-hosted WS client)
- [x] Phase 4: `IndexedDbReplicaStore` + README platform matrix
- [x] Phase 5: skill map + docs

### Verify

- [x] Unit tests green (crypto/common/core)
- [x] `test:int:narrow` green (after WS-on-Node made opt-in via `/ws` listen addrs)
- [x] `test:int:hybrid-browser-stack` green

### Follow-ups (not blocking)

- Real browser (Playwright/Vitest browser) smoke
- Circuit-relay for browser↔browser
- IndexedDB reload persistence smoke in apps/web

---

## Closed

### Tier 2 Compose Interop — closed (v1)

**Spec:** [tasks/tier2-compose-interop.md](tier2-compose-interop.md)  
**Status:** Closed — PR A–D merged (#42–#45) on 2026-07-19.

Follow-ups: watch Compose Interop Nightly; optional Compose PR-gate after flake &lt; 5%.

### Prior closed work

- Adaptive anti-entropy scheduling (Tier 1) — see related tier1 docs.
