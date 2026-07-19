# Active: Tier 2 PR D — Nightly CI + split-brain

**Spec:** [tasks/tier2-compose-interop.md](tier2-compose-interop.md) § PR D  
**Base:** `develop` (PR A–C merged: #42, #43, #44)  
**Branch (proposed):** `feat/tier2-compose-nightly-split-brain`  
**Status:** Implementing (approved 2026-07-19) → raising PR

## Goal

Schedule Compose soak on `develop` (12-node lan + wan) and port Tier 1 **split-brain heal** to multi-container Compose — without promoting Compose to a required PR gate.

## Decisions (approve / amend)

| ID | Decision | Rationale |
|----|----------|-----------|
| **D1** | Split-brain isolation = **orchestrator dial map** (intra-partition mesh only) **+** mid-run **`iptables` DROP** A↔B, flush on heal | Matches D4 (“partition is only mid-run mutation”); bootstrap-only alone is weaker than Tier 2 promise |
| **D2** | New workflow `.github/workflows/compose-interop-nightly.yml` (keep PR workflow as-is) | Separate schedule/timeouts from path-filtered PR jobs; mirrors `interop-scale-nightly.yml` |
| **D3** | Nightly cron `0 4 * * *` (after scale nightly at 03:00) + `workflow_dispatch` | Avoid runner contention with worker-thread scale matrix |
| **D4** | Nightly jobs: `late-joiner-lan` (12), `late-joiner-wan` (12), `split-brain` (6 even nodes, lan); parallel; always teardown | Spec acceptance; 6-node split-brain keeps wall time sane for first soak |
| **D5** | Split-brain **not** on every Compose PR job; optional `workflow_dispatch` / path-filter later after flake budget | P1 scenario; PR C already exercises lan/wan/A/B |
| **D6** | Image adds `iptables` (nft/legacy as available on bookworm); partition script via `docker exec` from host orchestrator helper | Containers already have `NET_ADMIN` from PR C |
| **D7** | Document flake policy in Compose README: promote to required PR gate only after **7 nights &lt; 5% flake** | Spec explicit; no gate change in this PR |

## Split-brain choreography (Compose)

Port of `simulateSplitBrainConvergence` (`InterOpScenarios.ts`):

1. Start **even** `COMPOSE_NODES` (default 6): indices `0..half-1` = partition A, `half..N-1` = B  
2. Wait ready; collect listen addrs  
3. **Partition:** apply iptables DROP between A and B container IPs; mesh **only** within each side  
4. Each side `produce_messages_replication` + settle; collect hash unions per side (assert sides diverge)  
5. **Heal:** flush iptables; cross-dial all peers; settle  
6. `set_expected_hashes` = union; poll until every node has full union (`hasTargetData` / replica coverage)  
7. Report JSON under `reports/` (reuse `WorkerResult` / reporter — no new metrics schema)

## Deliverables

```
packages/core/tests/compose-interop/
├── scenarios/split-brain.ts
├── scripts/
│   ├── apply-partition.sh      # docker exec iptables DROP/flush between cohorts
│   ├── run-split-brain.sh      # lifecycle wrapper → split-brain orchestrator
│   └── run-scenario.sh         # minor: support ROLE=producer for all nodes / generic entry
├── Dockerfile                  # + iptables
└── README.md                   # nightly, split-brain, flake policy

.github/workflows/compose-interop-nightly.yml
packages/core/package.json      # test:compose:split-brain
```

Yarn:

- `test:compose:split-brain` → `run-split-brain.sh`

## Acceptance checks

1. Nightly workflow exists, dispatchable, schedules on `develop`  
2. Nightly jobs: 12-node lan + 12-node wan late-joiner + 6-node split-brain; `if: always()` teardown  
3. Local/GHA: split-brain heal → all nodes hold union hashes  
4. Flake policy documented; Compose still **not** a required PR gate  
5. Existing PR Compose Interop (lan/wan/A/B) unchanged in intent  

## Implementation slices

1. [x] `iptables` in image + `apply-partition.sh`  
2. [x] `split-brain.ts` orchestrator + `run-split-brain.sh` + yarn script  
3. [x] `compose-interop-nightly.yml` (12 lan / 12 wan / split-brain)  
4. [x] README flake policy + PR workflow split-brain smoke  
5. [x] Push PR [#45](https://github.com/Ahmed-Abdul-Rahman/de-chat/pull/45); await GHA green  



## Out of scope

- Promoting Compose to required PR check  
- Offline-revival / peer-churn Compose ports  
- Changing `adaptive.enabled` default  
- 24/50-node Compose scale (Tier 1 worker nightly covers that)

---

# Prior: Tier 2 PR C — A/B + netem (merged #44)

See git history / [tasks/tier2-compose-interop.md](tier2-compose-interop.md). Closed.

---

# Prior: Adaptive Anti-Entropy Scheduling (closed)

See [tasks/tier2-compose-interop.md](tier2-compose-interop.md) and git history. Closed.
