---
status: accepted
---

# Adaptive anti-entropy scheduling (phased telemetry → heuristics)

`AntiEntropyManager` today runs on a fixed `syncIntervalMs`, picks a **random** connected peer, and retries partial trie drill-downs with exponential backoff inside a single attempt. That is sufficient for correctness but wasteful on bandwidth: dormant rooms sync as often as active ones, and peers that repeatedly return zero new hashes are as likely to be selected as useful sync partners.

We will add **observable sync metrics first**, then **rule-based adaptive scheduling** on the control plane only. The data plane (Merkle trie diff, hash validation, auth-gated replication) stays deterministic. LLMs and TinyML are explicitly out of scope for this ADR; a learned `SyncScheduler` strategy may be considered only after heuristics plateau and telemetry provides a training/evaluation baseline.

Dial-queue intelligence is deferred — `DialQueue`, `SimplePeerScorer`, and PEX already throttle connections.

## Phased scope

| Phase | Goal | Delivers |
|-------|------|----------|
| **0 — Metrics** | Make sync behaviour observable and testable | `AntiEntropyMetrics` seam, sliding-window store, instrumentation hooks |
| **1 — Peer selection** | Stop wasting cycles on useless peers | Convergence-weighted peer pick, idle-sync skip |
| **2 — Adaptive interval** | Match sync cadence to urgency | Dynamic `syncIntervalMs` within bounded floor/ceiling |

Phase 3+ (optional, not in scope): pluggable `SyncScheduler` adapter with ONNX/Wasm model behind the same `getStateVector()` interface. Requires a separate ADR if pursued.

---

## Metrics seam (Phase 0)

Follow the existing `DeChatMetrics` pattern (`DialQueueMetrics`, basic/noop implementations). Add `AntiEntropyMetrics` to `DeChatComponents.metrics` — not a monolithic `NodeTelemetryService`.

### Event hooks (instrumentation sites)

| Hook site | When fired |
|-----------|------------|
| `AntiEntropyManager.performScheduledSync` | Scheduled tick starts / skipped (mutex, no peers, idle skip) |
| `AntiEntropyNetworkExchange.syncWithPeer` | Outbound sync attempt completes (`SyncOutcome` or `null`) |
| `AntiEntropyNetworkExchange` inbound handler | Inbound bidirectional sync discovers missing hashes |
| `AntiEntropyManager.fetchMissingData` | Per-hash pull attempt (success / failure / duration) |

### Recorded events (sliding windows)

All windows are **in-memory circular buffers** on the node. Default window size: **20 events** (configurable). No persistence, no cross-node aggregation.

| Metric key | Type | Window | Definition |
|------------|------|--------|------------|
| `syncAttemptOutcome` | boolean ring | last N attempts | `true` = `SyncOutcome.status === 'complete'`; `false` = partial or stream failed (`null`) |
| `syncAttemptDurationMs` | number ring | last N attempts | Wall time from dial to outcome (outbound only) |
| `syncHashesDiscovered` | number ring | last N attempts | `outcome.hashes.length` per outbound attempt |
| `syncIncompleteReason` | enum counter | rolling | Count by `SyncIncompleteReason` (`timeout`, `badResponse`, `depthCap`) |
| `timeSinceLastSyncMs` | gauge | — | `Date.now() - lastCompletedOutboundSyncAt` |
| `timeSinceLastUsefulSyncMs` | gauge | — | Last outbound sync where `hashesDiscovered > 0` |
| `replicationActivityRate` | rate | 5 min | Local `onLocalDataProduced` / ANNOUNCE events per minute (proxy for chat activity until app layer exists) |
| `peerConvergenceScore` | map → float | EMA per peer | See below |

### `peerConvergenceScore` (per `PeerId`)

Separate from `SimplePeerScorer` (PEX/dial trust). Measures **sync utility only**.

```
on useful sync (hashesDiscovered > 0):
  score = min(1.0, score + α * min(1, hashesDiscovered / 10))
on useless sync (complete, hashesDiscovered === 0):
  score = max(0.0, score - β)
on failed sync (null outcome or partial):
  score = max(0.0, score - γ)
```

Default smoothing: `α = 0.15`, `β = 0.05`, `γ = 0.10`. Scores decay toward `0.5` after `peerConvergenceIdleMs` (default 30 min) without interaction.

Peers with no history start at **0.5** (neutral).

### State vector (`getStateVector()`)

Normalized floats in `[0, 1]` for policy consumption. Order is stable for future model compatibility.

| Index | Name | Normalization |
|-------|------|---------------|
| 0 | `syncSuccessRate` | `sum(syncAttemptOutcome) / windowSize` |
| 1 | `syncTimeoutRate` | `timeoutCount / windowSize` |
| 2 | `meanSyncDuration` | `clamp(meanDurationMs / 30_000, 0, 1)` |
| 3 | `timeSinceLastSync` | `clamp(timeSinceLastSyncMs / maxIntervalMs, 0, 1)` |
| 4 | `timeSinceLastUsefulSync` | `clamp(timeSinceLastUsefulSyncMs / maxIntervalMs, 0, 1)` |
| 5 | `replicationActivityRate` | `clamp(msgsPerMin / 60, 0, 1)` |
| 6 | `meanHashesPerSync` | `clamp(meanHashes / 50, 0, 1)` |

Per-peer vector extension (Phase 1 peer pick only): index 7 = `peerConvergenceScore` for the candidate.

**Deferred metrics** (do not block Phase 0–2):

- `localUnsyncedDeltaSize` — needs a precise definition of "unsynced" vs "converged but not yet confirmed"
- `droppedPacketCount` — not exposed at libp2p app layer; revisit with transport instrumentation
- `peerBandwidthCapacity` — derive later from `fetchMissingData` byte timing

---

## Policy bounds (Phase 1–2)

All policies run in `AntiEntropyManager` (or a `SyncScheduler` strategy it delegates to). Policies may only affect **when** and **with whom** to sync — never **what** to accept or store.

### Phase 1 — Peer selection & idle skip

**Peer selection:** Replace `pickRandom(connections)` with weighted random sample. Weight = `peerConvergenceScore` (minimum weight `0.1` so unknown peers remain reachable). Fall back to uniform random if all scores are equal.

**Idle skip:** If the last **K** consecutive outbound syncs (default `K = 3`) were `complete` with `hashesDiscovered === 0` **and** `replicationActivityRate` is below threshold (default `< 0.05` normalized), skip the scheduled tick. `timeSinceLastSync` still advances; force a sync when `timeSinceLastSyncMs >= maxIntervalMs` regardless (eventual-consistency floor).

### Phase 2 — Adaptive interval

Compute next interval from state vector using a **deterministic heuristic** (not ML):

```
urgency = max(
  replicationActivityRate,
  1 - timeSinceLastUsefulSync,
  syncTimeoutRate,
  1 - syncSuccessRate
)
nextIntervalMs = clamp(
  lerp(maxIntervalMs, minIntervalMs, urgency),
  minIntervalMs,
  maxIntervalMs
)
nextIntervalMs += jitter(0, jitterMs)   // equal jitter, same pattern as retry backoff
```

**Bounds (defaults, configurable under `config.strategies.synchronizer.adaptive`):**

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| `minIntervalMs` | `15_000` | Fast enough for active chat; matches interop test overrides |
| `maxIntervalMs` | `300_000` (5 min) | Eventual-consistency ceiling for dormant rooms |
| `jitterMs` | `5_000` | Desynchronize nodes to avoid sync storms |
| `idleSkipStreak` | `3` | Consecutive zero-hash complete syncs before skip |
| `idleActivityThreshold` | `0.05` | Normalized replication rate below which room is "dormant" |
| `convergenceWindowSize` | `20` | Sliding window for outcome metrics |
| `minPeerWeight` | `0.1` | Floor weight for unexplored peers |

Existing `retry` config (`maxRetries`, `baseBackoffMs`, `maxBackoffMs`) is unchanged — it governs intra-attempt partial retries, not inter-attempt scheduling.

### Safety invariants (must hold in all phases)

1. **Data plane untouched** — trie diff, hash verification, auth, and replication accept/reject logic are not policy-driven.
2. **Floor sync** — at least one outbound sync attempt every `maxIntervalMs` while connections exist.
3. **Mutex preserved** — overlapping scheduled syncs remain forbidden (`isSyncing` lock).
4. **Scorer separation** — `peerConvergenceScore` does not read or write `SimplePeerScorer`.
5. **No peer exclusion** — low convergence score reduces selection weight; never hard-blocks a connected peer from sync.
6. **Inbound sync unaffected** — bidirectional handler path is not gated by adaptive policy.

---

## Considered options

| Option | Why rejected (for now) |
|--------|------------------------|
| **LLM per node for network control** | Latency, cost, non-determinism incompatible with libp2p timing |
| **TinyML / ONNX scheduler in Phase 0** | No telemetry baseline; heuristics likely sufficient |
| **Extend `SimplePeerScorer` for sync** | Conflates PEX trust with sync utility; different decay semantics |
| **Monolithic `NodeTelemetryService`** | Breaks existing metrics seam; harder to noop in tests |
| **Fixed interval + random peer (status quo)** | Correct but bandwidth-wasteful as chat history grows |
| **Telemetry → heuristics → optional ML (chosen)** | Incremental, testable, reversible per phase |

---

## Consequences

- **Interop tests:** Phase 0 enables assertions on sync outcomes instead of fixed `syncIntervalMs * N` sleeps. Phase 1–2 may require scenario-specific `adaptive` overrides or disabled adaptive mode (`adaptive.enabled: false` falls back to current behaviour).
- **Metrics config:** Reuses `config.metrics.enabled`; noop implementation when disabled (same as dial/PEX metrics).
- **Memory:** Bounded by window size × peer map entries; negligible on consumer devices.
- **Chat app layer:** `replicationActivityRate` is a stand-in until room-scoped activity exists; future ADR may add per-topic vectors.
- **Bandwidth wins:** Primarily from idle skip + longer intervals in dormant state; peer weighting reduces wasted trie exchanges.
- **Risk — sync storms:** Mitigated by `jitterMs` and per-node independent clocks; monitor `syncAttemptDurationMs` in Phase 0 before enabling Phase 2 broadly.

---

## Related

- [ADR-0001: Topic-based replication for chat rooms](./0001-topic-based-replication-for-chat-rooms.md) — full replication makes anti-entropy the convergence backstop
- [ADR-0002: TOMBSTONE event sourcing for deletions](./0002-tombstone-event-sourcing-for-deletions.md) — trie only grows; sync policy must not assume shrinking state
- `packages/core/src/data-convergence/AntiEntropyManager.ts` — current scheduler
- `packages/core/src/data-convergence/AntiEntropyNetworkExchange.ts` — `SyncOutcome` instrumentation source
- `packages/core/src/metrics/` — existing metrics seam to extend