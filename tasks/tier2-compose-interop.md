# Task: Tier 2 — Docker Compose Interop

**Backlog ref:** [BACKLOG.md § Task 5.2](../BACKLOG.md#task-52-tier-2--docker-compose-interop-real-network-isolation-at-scale)  
**ADR ref:** [docs/adr/0003-adaptive-anti-entropy-scheduling.md](../docs/adr/0003-adaptive-anti-entropy-scheduling.md)  
**Prerequisite:** Tier 1 closed ([PR #37](https://github.com/Ahmed-Abdul-Rahman/de-chat/pull/37)) + Bandit merged ([PR #39](https://github.com/Ahmed-Abdul-Rahman/de-chat/pull/39)); nightlies healthy on `develop`  
**Closed chapter archive:** [adaptive-anti-entropy-scheduling.md](adaptive-anti-entropy-scheduling.md) (kept out of `tasks/todo.md` to avoid merge conflicts)  
**Status:** Approved — PR A in progress (`feat/tier2-node-runner-extract`)  
**Goal:** Prove anti-entropy convergence under **real TCP between containers** with optional latency / loss / partition profiles — without Testground.

---

## Executive summary

Tier 1 proved adaptive scheduling on a single host via worker threads. That cannot catch:

- GossipSub / dial behaviour across real network namespaces
- Latency / bandwidth asymmetry
- Partition + heal with real `iptables` / `tc netem`
- Multiaddr discovery that is not `127.0.0.1` + shared loopback

Tier 2 follows the path libp2p took after leaving Testground: **Docker Compose + netem + Redis barriers**, TypeScript-native, nightly-only until flake rate is low.

**Non-goals for v1:** Kubernetes, 500+ nodes, browser/WebRTC, changing production `adaptive.enabled` default.

---

## Current state (what we reuse)

| Asset | Location | Role in Tier 2 |
|-------|----------|----------------|
| Node lifecycle | `tests/interop/childThread/workerUitls.ts` → `configureNode` | Shared engine setup |
| Replication + anti-entropy worker | `tests/interop/childThread/nodeWorkerData.ts` | Logic to extract into `nodeRunner` |
| Control messages | `statistics`, `produce_messages_replication`, `set_expected_hashes`, `connect_peers`, `report_hashes`, `report_listen_addrs`, `terminate` | Become Redis/HTTP commands |
| Result shape | `WorkerResult` / `AntiEntropyInteropSummary` / `interopTestReporter.ts` | **Reuse — no second metrics schema** |
| Scenario choreography | `InterOpScenarios.ts` | Port timing / barriers; do not fork forever |
| Nightly CI pattern | `.github/workflows/interop-scale-nightly.yml` | Template for compose nightly |

---

## Architecture decisions (need approval)

### D1 — Shared `nodeRunner`, thin transports

```
                    ┌─────────────────────────────┐
                    │  nodeRunner.ts              │
                    │  start / command handlers / │
                    │  stats snapshot / cleanup   │
                    └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                                       ▼
   WorkerTransport (parentPort)              ComposeTransport (Redis)
   existing worker threads                   container entrypoint
```

- Extract **command handling + node lifecycle** from `nodeWorkerData.ts` into `packages/core/tests/interop/nodeRunner.ts`.
- Worker keeps `parentPort` adapter; Compose uses Redis pub/sub (or Redis lists) for the same command names.
- **Do not** duplicate `configureNode` / anti-entropy snapshot mapping.

### D2 — Redis for barriers + commands (not HTTP v1)

| Channel | Purpose |
|---------|---------|
| Redis keys `barrier:*` | Mesh-ready, producers-done, heal-ready |
| Redis pub/sub `cmd:{nodeIndex}` | Orchestrator → node commands |
| Redis key `stats:{nodeIndex}` | Final `WorkerResult` JSON |
| Redis key `addrs:{nodeIndex}` | Published listen multiaddrs for bootstrap |

**Why Redis over HTTP:** matches libp2p compose patterns, simpler barrier sync, no per-node port matrix. HTTP can be added later if debugging needs curl.

### D3 — Bootstrap via Redis-published multiaddrs

- Each node listens on `0.0.0.0:<PORT>` (TCP).
- On start, publish `/ip4/<container-ip>/tcp/<port>/p2p/<peerId>` to Redis.
- Orchestrator / late joiner reads bootstrap set from Redis — **never** hardcode `127.0.0.1` for cross-container dials.
- mDNS: **off** in Compose (`enableMdns: false`) to avoid cross-talk and flaky discovery; rely on explicit bootstrap + PEX.

### D4 — Netem applied at container start (static profiles)

v1 profiles (shell scripts, not dynamic mid-test shaping except partition):

| Profile | `tc` / iptables | Use |
|---------|-----------------|-----|
| `lan` | none / negligible | Parity with worker interop |
| `wan` | `delay 50ms 10ms`, `rate 10mbit` | Realistic chat path |
| `lossy` | `loss 1%`, `delay 100ms` | Partial sync / retry |
| `partition` | `iptables` drop A↔B for T seconds then heal | Split-brain |

Partition is the only mid-run mutation; others are set once at start.

### D5 — Nightly only; Tier 1 remains PR gate

- Compose jobs are **not** PR-blocking until: wall time < 15 min for P0 scenario, flake < 5% over 7 nights.
- Worker-thread interop stays the fast correctness gate.

### D6 — Defaults unchanged

- Production / library default: `adaptive.enabled: false`.
- Compose scenarios opt in via env (`ADAPTIVE_ENABLED=true`, `SCHEDULER=heuristic|bandit|fixed`).

---

## Proposed layout

```
packages/core/tests/
├── interop/
│   ├── nodeRunner.ts                 # NEW — shared lifecycle + commands
│   ├── childThread/
│   │   ├── nodeWorkerData.ts         # thin: WorkerTransport → nodeRunner
│   │   └── workerUitls.ts            # unchanged configureNode
│   └── ...
└── compose-interop/
    ├── README.md
    ├── docker-compose.yml
    ├── docker-compose.scale.yml
    ├── Dockerfile
    ├── scripts/
    │   ├── run-scenario.sh
    │   ├── wait-redis-barrier.sh
    │   ├── apply-netem.sh
    │   └── collect-stats.sh
    ├── netem/
    │   ├── lan.env
    │   ├── wan.env
    │   └── lossy.env
    ├── scenarios/
    │   ├── late-joiner-adaptive.ts   # orchestrator (Redis client)
    │   ├── dormant-room-ab.ts
    │   └── split-brain.ts            # P1
    └── reports/                      # gitignored + .gitkeep
```

---

## Scenario priority

| Priority | Scenario | Source | Assert |
|----------|----------|--------|--------|
| **P0** | Late joiner + adaptive | `simulateAntiEntropyConvergence` | `hasTargetData`, `usefulSyncs > 0`, report `convergenceMs` |
| **P0** | Fixed vs heuristic A/B | Tier 1 A/B | Both converge; heuristic `idleSkips > 0` on dormant producers after settle |
| **P1** | Split-brain heal | `simulateSplitBrainConvergence` | Union converges after heal |
| **P1** | Offline revival | `simulateOfflinePeerRevivalConvergence` | Late revival fetches target hashes |
| **P2** | WAN / lossy late joiner | P0 + netem | Converges within configurable × lan wall time (default 2×) |
| **P2** | Peer churn | `simulatePeerChurn` | No crash; mesh reforms |

**v1 merge goal:** P0 locally green + nightly workflow for late-joiner `lan` (6–12 nodes). P1/P2 can follow in later PRs.

---

## Phased PRs

### PR A — Extract `nodeRunner` (no Docker yet)

**Goal:** Shared module; worker behaviour unchanged.

- [ ] Create `nodeRunner.ts` with:
  - `startNodeRunner(config, transport)`
  - Handlers for existing command types used by data-sync scenarios
  - Same `WorkerResult` / anti-entropy mapping as today
- [ ] Refactor `nodeWorkerData.ts` to delegate to `nodeRunner` via `parentPort` transport
- [ ] Unit/integration: existing `test:int:data-sync` + adaptive A/B/scale still green
- [ ] No Compose files in this PR (keeps review focused)

**Acceptance:** CI green; no behaviour change in worker interop.

### PR B — Image + Compose + late joiner (lan)

**Goal:** First real multi-container convergence.

- [ ] `Dockerfile` (Node 22, yarn workspaces, build `@dechat/core`)
- [ ] `docker-compose.yml`: Redis 7 + `node` service + named network
- [ ] Compose entrypoint: `node dist/.../composeNodeMain.js` using Redis transport
- [ ] `run-scenario.sh` + Redis barriers for late-joiner choreography
- [ ] Scripts: `yarn workspace @dechat/core test:compose:late-joiner`
- [ ] README: prerequisites, local run, debugging

**Acceptance:**
- Local: 6 producers + 1 late joiner, `lan`, `adaptive.enabled=true` → late joiner `hasTargetData === true`
- Teardown: `docker compose down -v` leaves no zombies
- Report markdown/JSON under `compose-interop/reports/` reusing reporter types

### PR C — A/B + netem profiles

- [ ] `dormant-room-ab.ts` (or scripted dual run): fixed vs heuristic
- [ ] `apply-netem.sh` + `wan` / `lossy` profiles
- [ ] Assert heuristic idle skips in dormant phase; document wall-time trade-off
- [ ] WAN late-joiner converges within 2× lan (env-overridable)

**Acceptance:** A/B report artifact; wan profile green locally.

### PR D — Nightly CI + split-brain

- [ ] `.github/workflows/compose-interop-nightly.yml`
  - Jobs: `late-joiner-adaptive` (12 nodes, lan), `late-joiner-wan` (12 nodes, wan)
  - Always `docker compose down -v` in `if: always()`
- [ ] Port split-brain scenario (P1)
- [ ] Document flake policy: promote to PR gate only after 7 nights < 5% flake

**Acceptance:** Scheduled workflow green on `develop`; split-brain heal converges.

---

## Config / env contract (Compose node)

| Env | Required | Meaning |
|-----|----------|---------|
| `NODE_INDEX` | yes | 0..N-1 |
| `TOTAL_NODES` | yes | Cohort size |
| `NODE_SEED` | yes | Deterministic peer id seed |
| `ROLE` | yes | `producer` \| `late-joiner` |
| `REDIS_URL` | yes | e.g. `redis://redis:6379` |
| `LISTEN_PORT` | yes | TCP listen port inside container |
| `NETWORK_ID` | yes | DeChat network id |
| `ADAPTIVE_ENABLED` | no | default `false` |
| `SCHEDULER` | no | `fixed` \| `heuristic` \| `bandit` |
| `SYNC_INTERVAL_MS` | no | fixed-mode / max bound |
| `ENABLE_MDNS` | no | default `false` in Compose |
| `SUPPRESS_REPLICATION_INGEST` | no | late-joiner gate (match Tier 1) |
| `NETEM_PROFILE` | no | `lan` \| `wan` \| `lossy` |
| `LOG_LEVEL` | no | default `INFO` |

---

## CI sketch

```yaml
# .github/workflows/compose-interop-nightly.yml
on:
  schedule:
    - cron: '0 2 * * *'   # after / near existing scale nightly
  workflow_dispatch:

jobs:
  late-joiner-lan:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - run: yarn install --immutable
      - run: yarn workspace @dechat/core build
      - run: yarn workspace @dechat/core test:compose:late-joiner
        env:
          COMPOSE_NODES: 12
          ADAPTIVE_ENABLED: 'true'
          NETEM_PROFILE: lan
      - if: always()
        run: docker compose -f packages/core/tests/compose-interop/docker-compose.yml down -v
```

Exact image caching / compose file paths finalized in PR B.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Worker refactor breaks Tier 1 | PR A only; full `test:int:data-sync` + nightly stay green before Compose |
| Mesh never forms across containers | Explicit multiaddrs + Redis bootstrap; disable mDNS; reuse `STABILIZE_MS`-class waits |
| macOS netem gaps | Document Linux-only netem; CI on `ubuntu-latest` |
| Image build time | Layer cache; build once per workflow |
| Flaky GossipSub | Barriers after verified peer counts; start with 6–12 nodes |
| Zombie containers | Mandatory `down -v` in CI `always()` |
| Second metrics schema creep | **Forbidden** — reuse `WorkerResult` / reporter |

---

## Out of scope (v1)

- Testground / Kubernetes / kompose
- Browser or WebRTC nodes
- Promoting Compose to PR gate
- Changing default `adaptive.enabled`
- Dynamic mid-test bandwidth reshaping (except partition heal)
- Cross-version libp2p interop

---

## Effort estimate

| Phase | Effort | Output |
|-------|--------|--------|
| PR A — `nodeRunner` extract | 1–2 days | Workers green, shared module |
| PR B — Compose late joiner | 2–3 days | First container scenario green locally |
| PR C — A/B + netem | 2 days | wan + A/B report |
| PR D — Nightly + split-brain | 2 days | Scheduled workflow |

**Total:** ~7–10 dev-days.

---

## Approval checklist

Reply **approve** (or note changes) on these decisions before implementation starts:

- [ ] **D1** Extract shared `nodeRunner` + thin Worker/Redis transports
- [ ] **D2** Redis for barriers + commands (HTTP deferred)
- [ ] **D3** Bootstrap via Redis-published multiaddrs; mDNS off in Compose
- [ ] **D4** Static netem profiles; partition as only mid-run mutation
- [ ] **D5** Nightly-only until flake budget met; Tier 1 remains PR gate
- [ ] **D6** Keep `adaptive.enabled` default `false`
- [ ] **PR order** A → B → C → D as above
- [ ] **v1 goal** P0 late-joiner + A/B; P1 split-brain in PR D

---

## Implementation status

- [x] Approval (2026-07-17)
- [x] PR A — `nodeRunner` extract ← **in progress** (`feat/tier2-node-runner-extract`; unit + `test:int:data-sync` green locally)
- [ ] PR B — Compose + late joiner (lan)
- [ ] PR C — A/B + netem
- [ ] PR D — Nightly CI + split-brain
- [ ] Optional: promote Compose job to PR gate after soak
