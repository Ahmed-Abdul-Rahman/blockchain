# Task: Adaptive Anti-Entropy Scheduling

**Backlog ref:** Follow-up to BACKLOG Task 2.1 (anti-entropy correctness — done)  
**ADR ref:** [docs/adr/0003-adaptive-anti-entropy-scheduling.md](../docs/adr/0003-adaptive-anti-entropy-scheduling.md)  
**Status:** Implemented (Steps 0–5); CI verification pending on PR  
**Goal:** Make `AntiEntropyManager` observable and adaptive on the **control plane only** (when / with whom to sync). Data plane (Merkle trie diff, auth, replication accept/reject) stays deterministic.

### Prior completed work (do not re-implement)

- **Task 1.1 CBOR wire serialization** — completed 2026-06-28, PR #35. See BACKLOG.md.

### Approved decisions (research + ADR synthesis)

1. **Telemetry first** — no adaptive policy without `AntiEntropyMetrics` + `getStateVector()`
2. **Heuristics before ML** — ADR Phase 1–2 (EMA peer weight, idle skip, dynamic interval) ship before any bandit
3. **Bandit optional (Phase 3)** — epsilon-greedy MAB after heuristics plateau; Bengfort/Honu precedent, not greenfield
4. **Scorer separation** — `peerConvergenceScore` is sync-utility only; never read/write `SimplePeerScorer`
5. **No LLM / ONNX / deep RL** in this task — separate ADR if pursued later
6. **Pre-production** — `adaptive.enabled: false` restores current fixed-interval + random-peer behaviour exactly

### Research references (for implementer context)

| Source | Technique | Relevance |
|--------|-----------|-----------|
| [ADR-0003](../docs/adr/0003-adaptive-anti-entropy-scheduling.md) | Phased metrics → heuristics | **Source of truth** for this plan |
| Bengfort et al. ICDCS 2018 — *Anti-Entropy Bandits* | Epsilon-greedy MAB on peer pick | Phase 3 reward design |
| HonuDB ([rotationalio/honu](https://github.com/rotationalio/honu)) | Production bandit anti-entropy | Reference implementation |
| FlowGossip (Cornell) | AIMD rate control on gossip | Inspiration for urgency-based interval |
| IPFS Bitswap | Peer success registry + probabilistic pick | Similar to EMA convergence score |

---

## Problem Summary

`AntiEntropyManager` today:

| Behaviour | Location | Issue |
|-----------|----------|-------|
| Fixed `setInterval(syncIntervalMs)` | `AntiEntropyManager.start()` | Dormant rooms sync as often as active chat |
| `pickRandom(connections)` | `performScheduledSync()` | Useless peers selected as often as useful ones |
| No sync telemetry | — | Interop tests use `syncIntervalMs * N` sleeps |
| No pluggable scheduler | — | Cannot A/B fixed vs heuristic vs bandit |

**What already works (do not change logic):**

- `AntiEntropyNetworkExchange` — Merkle trie drill-down, `SyncOutcome` (`complete` / `partial` + reason)
- Intra-attempt exponential backoff retry (`config.retry`)
- Inbound bidirectional sync via `onMissingHashesDiscovered`
- `isSyncing` mutex

---

## Architecture Decision

### Control plane vs data plane

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE (adaptive — this task)                           │
│  SyncScheduler → pickPeer(), shouldSkipTick(), nextIntervalMs() │
│  AntiEntropyMetrics → sliding windows, peer EMA, getStateVector() │
│  AntiEntropyManager → dynamic timer, delegates to scheduler       │
└─────────────────────────────────────────────────────────────────┘
                              │ when / whom only
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  DATA PLANE (unchanged)                                         │
│  AntiEntropyNetworkExchange.executeSyncFlow()                   │
│  PrefixTrie.findMismatches / getTopN / getBranches              │
│  DataReplication.requestMissingData() + auth gates              │
└─────────────────────────────────────────────────────────────────┘
```

### Scheduler strategy pattern

```typescript
/** Pluggable outbound sync policy. Must not affect data-plane accept/reject. */
export interface SyncScheduler {
  /** Pick one connected peer for outbound sync. */
  pickPeer(candidates: readonly PeerId[]): PeerId;

  /** Whether to skip this scheduled tick (idle skip). Floor sync overrides in manager. */
  shouldSkipTick(ctx: SyncTickContext): boolean;

  /** Delay until next scheduled outbound sync attempt. */
  nextIntervalMs(ctx: SyncTickContext): number;

  /** Called after each outbound attempt so policy can update internal state. */
  onOutboundSyncComplete(record: SyncAttemptRecord): void;
}
```

**Implementations:**

| Class | Phase | Behaviour |
|-------|-------|-----------|
| `FixedSyncScheduler` | Baseline | Random peer; `config.syncIntervalMs`; never skip |
| `HeuristicSyncScheduler` | ADR 1–2 | Weighted peer pick + idle skip + urgency interval |
| `BanditSyncScheduler` | Optional 3 | Epsilon-greedy MAB; delegates interval to heuristic or fixed |

Factory: `createSyncScheduler(config, metrics, peerConvergenceTracker)` in `scheduling/index.ts`.

### Timer model change (critical)

**Current:** `setInterval(fn, syncIntervalMs)` — cannot vary delay per tick.

**New:** recursive `scheduleNext()`:

```typescript
private scheduleNext(): void {
  if (!this.isRunning()) return;
  const delayMs = this.scheduler.nextIntervalMs(this.buildTickContext());
  this.syncTimer = setTimeout(() => {
    void this.performScheduledSync()
      .finally(() => this.scheduleNext());
  }, delayMs);
}
```

`stop()` must `clearTimeout(this.syncTimer)` (rename field comment from interval to timer).

When `adaptive.enabled === false`, `FixedSyncScheduler.nextIntervalMs()` returns `config.syncIntervalMs` — behaviour matches today.

### Config: `syncIntervalMs` vs `adaptive.*`

| `adaptive.enabled` | Interval source | Peer pick |
|--------------------|-----------------|-----------|
| `false` | `syncIntervalMs` only (default 60_000) | uniform random |
| `true` | `nextIntervalMs()` using `minIntervalMs`…`maxIntervalMs` | weighted by convergence score |

**Migration rule:** `syncIntervalMs` remains in config as **legacy fixed-mode interval** and as **default `maxIntervalMs`** when adaptive is enabled but `maxIntervalMs` omitted:

```typescript
maxIntervalMs: adaptive?.maxIntervalMs ?? syncIntervalMs
```

---

## Config Extension

**File:** `packages/core/src/config/types.ts`

```typescript
strategies: {
  synchronizer: {
    protocol: string;
    /** Used when adaptive.enabled=false; also fallback maxIntervalMs when adaptive.maxIntervalMs unset */
    syncIntervalMs: number;
    retry: { maxRetries: number; baseBackoffMs: number; maxBackoffMs: number };
    adaptive: {
      enabled: boolean;
      /** 'fixed' | 'heuristic' | 'bandit' — bandit only valid when enabled */
      scheduler: 'fixed' | 'heuristic' | 'bandit';
      minIntervalMs: number;
      maxIntervalMs: number;
      jitterMs: number;
      idleSkipStreak: number;
      /** Normalized activity threshold; compare against StateVector index 5 */
      idleActivityThreshold: number;
      convergenceWindowSize: number;
      minPeerWeight: number;
      peerConvergence: {
        alpha: number;  // useful sync boost
        beta: number;   // zero-hash complete decay
        gamma: number;  // failed/partial decay
        idleDecayMs: number;
        neutralScore: number;
      };
      bandit?: {
        epsilon: number;
        /** Annealing: epsilon *= decay per N attempts; 0 = no anneal */
        epsilonDecayPerAttempts: number;
        epsilonFloor: number;
      };
    };
  };
};
```

**File:** `packages/core/src/config/defaults.ts`

```typescript
synchronizer: {
  protocol: ANTI_ENTROPY_PROTOCOL, // from data-convergence/types
  syncIntervalMs: 60_000,
  retry: { maxRetries: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
  adaptive: {
    enabled: false,           // ship disabled; enable in interop after Phase 0 metrics validated
    scheduler: 'heuristic',
    minIntervalMs: 15_000,
    maxIntervalMs: 300_000,
    jitterMs: 5_000,
    idleSkipStreak: 3,
    idleActivityThreshold: 0.05,
    convergenceWindowSize: 20,
    minPeerWeight: 0.1,
    peerConvergence: {
      alpha: 0.15,
      beta: 0.05,
      gamma: 0.10,
      idleDecayMs: 30 * 60_000,
      neutralScore: 0.5,
    },
    bandit: {
      epsilon: 0.2,
      epsilonDecayPerAttempts: 0,
      epsilonFloor: 0.05,
    },
  },
},
```

---

## New Files

### 1. `packages/core/src/data-convergence/scheduling/types.ts`

```typescript
import { PeerId } from '@libp2p/interface';
import { SyncIncompleteReason } from '../types';

export type SyncSkipReason =
  | 'mutex'
  | 'no_peers'
  | 'idle_skip'
  | 'floor_sync_forced'; // skipped idle but floor timer fired

export type SyncAttemptResult =
  | { kind: 'complete'; hashesDiscovered: number; durationMs: number }
  | { kind: 'partial'; hashesDiscovered: number; durationMs: number; reason: SyncIncompleteReason }
  | { kind: 'failed'; durationMs: number }; // null outcome from exchange

export interface SyncAttemptRecord {
  readonly peerId: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly result: SyncAttemptResult;
}

export interface SyncTickContext {
  readonly now: number;
  readonly timeSinceLastSyncMs: number;
  readonly timeSinceLastUsefulSyncMs: number;
  readonly consecutiveZeroHashComplete: number;
  readonly stateVector: readonly number[]; // length 7, normalized [0,1]
  readonly forceFloorSync: boolean;
}

/** Stable order for future ML — ADR indices 0–6 */
export const STATE_VECTOR_NAMES = [
  'syncSuccessRate',
  'syncTimeoutRate',
  'meanSyncDuration',
  'timeSinceLastSync',
  'timeSinceLastUsefulSync',
  'replicationActivityRate',
  'meanHashesPerSync',
] as const;

export type StateVector = readonly [
  number, number, number, number, number, number, number,
];

export interface SyncScheduler {
  pickPeer(candidates: readonly PeerId[]): PeerId;
  shouldSkipTick(ctx: SyncTickContext): boolean;
  nextIntervalMs(ctx: SyncTickContext): number;
  onOutboundSyncComplete(record: SyncAttemptRecord): void;
}
```

---

### 2. `packages/core/src/data-convergence/scheduling/SlidingWindowRingBuffer.ts`

Generic fixed-size circular buffer for metrics:

```typescript
export class SlidingWindowRingBuffer<T> {
  constructor(private readonly capacity: number) {}
  push(value: T): void;
  toArray(): readonly T[];
  readonly length: number;
  clear(): void;
}
```

Used for: `syncAttemptOutcome`, `syncAttemptDurationMs`, `syncHashesDiscovered`.

---

### 3. `packages/core/src/data-convergence/scheduling/PeerConvergenceTracker.ts`

Per-peer EMA scores per ADR formula. **Does not import `SimplePeerScorer`.**

```typescript
export class PeerConvergenceTracker {
  constructor(config: DeChatConfig['strategies']['synchronizer']['adaptive']['peerConvergence']);

  getScore(peerId: string): number;
  onUsefulSync(peerId: string, hashesDiscovered: number): void;
  onUselessSync(peerId: string): void;
  onFailedSync(peerId: string): void;
  decayIdlePeers(now: number): void;
  snapshot(): ReadonlyMap<string, number>; // for tests/debug
}
```

**Weight for peer pick:**

```typescript
weight(peerId) = Math.max(minPeerWeight, getScore(peerId))
```

Weighted random sample via `es-toolkit` or small local helper (no new dependency).

---

### 4. `packages/core/src/data-convergence/scheduling/ReplicationActivityTracker.ts`

5-minute sliding window of local production events:

```typescript
export class ReplicationActivityTracker {
  recordLocalProduce(): void;
  recordRemoteReceive(): void; // optional; gossip proxy
  /** Events per minute, normalized to msgsPerMin for StateVector */
  getRatePerMinute(now: number): number;
}
```

**Hook sites (Phase 0):**

- `KReplicaContentReplication.onLocalDataProduced` — `recordLocalProduce()`
- `TopicBasedContentReplication.onLocalDataProduced` — same
- Optional: `GossipSubPropagationMetrics.messagePublished` on replication topic — defer if duplication

---

### 5. `packages/core/src/data-convergence/scheduling/StateVectorBuilder.ts`

```typescript
export class StateVectorBuilder {
  constructor(
    private readonly metrics: AntiEntropyMetricsStore,
    private readonly maxIntervalMs: number,
  ) {}

  build(now: number): StateVector;
  buildForPeer(peerId: string, now: number): readonly number[]; // 8 elements, index 7 = peer score
}
```

Normalization table — **must match ADR exactly** (indices 0–6).

---

### 6. `packages/core/src/data-convergence/scheduling/FixedSyncScheduler.ts`

Preserves current behaviour when `adaptive.enabled === false`.

```typescript
export class FixedSyncScheduler implements SyncScheduler {
  constructor(
    private readonly syncIntervalMs: number,
    private readonly pickRandom: typeof pickRandom,
  ) {}
  // pickPeer: uniform random
  // shouldSkipTick: always false
  // nextIntervalMs: syncIntervalMs
  // onOutboundSyncComplete: no-op
}
```

---

### 7. `packages/core/src/data-convergence/scheduling/HeuristicSyncScheduler.ts`

ADR Phase 1–2 logic.

**`pickPeer`:** weighted random by `PeerConvergenceTracker.getScore`; fallback uniform if all weights equal.

**`shouldSkipTick`:**

```typescript
if (ctx.forceFloorSync) return false;
if (ctx.consecutiveZeroHashComplete < idleSkipStreak) return false;
if (ctx.stateVector[5] >= idleActivityThreshold) return false; // replicationActivityRate
return true;
```

**`nextIntervalMs`:**

```typescript
const urgency = Math.max(
  ctx.stateVector[5],                    // replicationActivityRate
  1 - ctx.stateVector[4],                // timeSinceLastUsefulSync
  ctx.stateVector[1],                    // syncTimeoutRate
  1 - ctx.stateVector[0],                // 1 - syncSuccessRate
);
const base = lerp(maxIntervalMs, minIntervalMs, urgency);
return base + equalJitter(0, jitterMs);
```

Extract `lerp` / `equalJitter` to `scheduling/math.ts` (reuse pattern from `computeBackoffMs` in manager).

---

### 8. `packages/core/src/data-convergence/scheduling/bandit/` (Phase 3 — optional stretch)

Only after Phase 0–2 green in CI + interop A/B.

```
bandit/
├── RewardFunction.ts      # DeChat-adapted Bengfort Table 6.1
├── EpsilonGreedyPolicy.ts
├── DynamicArmSet.ts       # add/remove peers on connect/disconnect
└── BanditSyncScheduler.ts
```

**Reward function (DeChat — no version vectors):**

| Signal | Reward component |
|--------|------------------|
| `complete` + hashes > 0 | `0.5 + 0.1 * min(1, hashes/10)` |
| `complete` + hashes === 0 | `0.1` (converged, not useless) |
| `partial` | `0.05 * (hashes / max(1, expected))` partial credit |
| `failed` | `0` |

**Critical:** Distinguish **converged** (complete, 0 hashes) from **useless streak** (idle skip handles dormancy, not zero reward forever).

**No new npm dependencies** — pure TypeScript bandit.

---

### 9. `packages/core/src/data-convergence/scheduling/index.ts`

```typescript
export const createSyncScheduler = (
  config: DeChatConfig['strategies']['synchronizer'],
  metricsStore: AntiEntropyMetricsStore,
  peerTracker: PeerConvergenceTracker,
): SyncScheduler => { ... };
```

---

### 10. Metrics module

#### `packages/core/src/metrics/interfaces/AntiEntropyMetrics.ts`

Event-sink interface (fire-and-forget hooks):

```typescript
export type SyncSkipReason = /* import from scheduling/types */;

export interface AntiEntropyMetrics {
  readonly namespace: 'anti_entropy';

  scheduledTickStarted(): void;
  scheduledTickSkipped(reason: SyncSkipReason): void;

  outboundSyncStarted(peerId: string): void;
  outboundSyncCompleted(record: SyncAttemptRecord): void;

  inboundSyncDiscoveredHashes(peerId: string, count: number): void;

  fetchHashStarted(peerId: string, hash: string): void;
  fetchHashCompleted(peerId: string, hash: string, durationMs: number, success: boolean): void;
}
```

#### `packages/core/src/metrics/basic/BasicAntiEntropyMetrics.ts`

Implements hooks **and** owns `AntiEntropyMetricsStore` (ring buffers + gauges + peer tracker updates).

Alternatively split:

- `AntiEntropyMetricsStore` — queryable state for scheduler
- `BasicAntiEntropyMetrics` — implements `AntiEntropyMetrics` interface, writes to store

**Recommendation:** Single `AntiEntropyMetricsStore` class with both record + query methods; `BasicAntiEntropyMetrics` wraps it for the metrics seam; `NoopAntiEntropyMetrics` discards events.

#### `packages/core/src/metrics/noop/NoopAntiEntropyMetrics.ts`

All methods no-op. Scheduler still works via `PeerConvergenceTracker` updated directly in manager when metrics disabled — **decision:**

When `config.metrics.enabled === false`:
- Use in-memory `PeerConvergenceTracker` + minimal local counters inside `AntiEntropyManager` OR
- Always instantiate `AntiEntropyMetricsStore` internally (not exported) but skip `BaseMetrics.snapshot` counters

**Decision:** Always create `AntiEntropyMetricsStore` for scheduler correctness; `metrics.enabled` only controls `BaseMetrics` counter export. Document in ADR consequences update.

#### Store query API

```typescript
export interface AntiEntropyMetricsStore {
  recordOutboundAttempt(record: SyncAttemptRecord): void;
  recordSkip(reason: SyncSkipReason): void;
  getConsecutiveZeroHashComplete(): number;
  getTimeSinceLastSyncMs(now: number): number;
  getTimeSinceLastUsefulSyncMs(now: number): number;
  getStateVector(now: number): StateVector;
  getPeerConvergenceTracker(): PeerConvergenceTracker;
  getActivityTracker(): ReplicationActivityTracker;
  snapshot(): AntiEntropyMetricsSnapshot; // for tests
}
```

---

### 11. Unit tests (new)

| File | Coverage |
|------|----------|
| `tests/unit/data-convergence/scheduling/SlidingWindowRingBuffer.unit.test.ts` | capacity, wrap, toArray |
| `tests/unit/data-convergence/scheduling/PeerConvergenceTracker.unit.test.ts` | α/β/γ, neutral start, decay |
| `tests/unit/data-convergence/scheduling/StateVectorBuilder.unit.test.ts` | normalization clamps |
| `tests/unit/data-convergence/scheduling/HeuristicSyncScheduler.unit.test.ts` | idle skip, floor override, urgency interval bounds |
| `tests/unit/data-convergence/scheduling/FixedSyncScheduler.unit.test.ts` | matches legacy behaviour |
| `tests/unit/metrics/BasicAntiEntropyMetrics.unit.test.ts` | ring buffers, skip reasons |
| `tests/unit/data-convergence/scheduling/bandit/EpsilonGreedyPolicy.unit.test.ts` | Phase 3 only |

---

## Modified Files

### A. `packages/core/src/data-convergence/AntiEntropyManager.ts`

**Constructor additions:**

```typescript
private readonly scheduler: SyncScheduler;
private readonly metricsStore: AntiEntropyMetricsStore;
private readonly adaptiveConfig: DeChatConfig['strategies']['synchronizer']['adaptive'];
```

Wire in constructor:

```typescript
this.metricsStore = createAntiEntropyMetricsStore(config.strategies.synchronizer);
this.scheduler = createSyncScheduler(config.strategies.synchronizer, this.metricsStore);
```

**`start()`:** replace `setInterval` with `scheduleNext()`.

**`performScheduledSync()` changes:**

1. Record `scheduledTickStarted()`
2. Build `SyncTickContext` via `buildTickContext()`
3. If `shouldSkipTick(ctx)` && !`ctx.forceFloorSync` → record skip `idle_skip`, return
4. Mutex check → skip `mutex`
5. `connections.length === 0` → skip `no_peers`
6. `targetPeerId = scheduler.pickPeer(connections.map(c => c.remotePeer))`
7. Time outbound sync; on complete call `scheduler.onOutboundSyncComplete(record)` + `metricsStore.recordOutboundAttempt`
8. Update `consecutiveZeroHashComplete` in store

**Floor sync logic:**

```typescript
private buildTickContext(): SyncTickContext {
  const now = Date.now();
  const timeSinceLastSync = this.metricsStore.getTimeSinceLastSyncMs(now);
  const forceFloorSync =
    this.adaptiveConfig.enabled &&
    timeSinceLastSync >= this.adaptiveConfig.maxIntervalMs;
  return { now, forceFloorSync, ... };
}
```

**`fetchMissingData`:** wrap each `requestMissingData` with `fetchHashStarted/Completed` hooks.

**Peer source:** keep `libp2p.getConnections()` for now. Add TODO comment: consider `PeerRegistry` authenticated peers only. **Do not switch in Phase 0** — behaviour change needs separate review.

---

### B. `packages/core/src/data-convergence/AntiEntropyNetworkExchange.ts`

**`syncWithPeer`:** accept optional `onAttemptComplete` callback OR manager wraps timing externally.

**Decision:** Manager times `syncWithPeer` externally (simpler, no exchange API change). Exchange unchanged except:

**Inbound handler:** after `onMissingHashesDiscovered`, manager's callback already exists — add metrics hook in manager's bound listener:

```typescript
this.exchangeEngine.onMissingHashesDiscovered = (hashes, peerId) => {
  this.metricsStore.recordInboundHashes(peerId.toString(), hashes.length);
  // existing fetchMissingData...
};
```

---

### C. `packages/core/src/data-replication/KReplicaContentReplication.ts`

After successful local produce path starts:

```typescript
components.strategies?.antiEntropyManager?.recordReplicationActivity?.()
```

**Cleaner:** inject `ReplicationActivityTracker` via components — **Decision:** expose `components.metricsStore` or pass tracker from manager factory.

**Simplest path:** `AntiEntropyMetricsStore` singleton on components:

```typescript
// types.ts
antiEntropyMetrics?: AntiEntropyMetricsStore;
```

Set in `antiEntropyManager` factory before returning manager. Replication engines call:

```typescript
components.antiEntropyMetrics?.getActivityTracker().recordLocalProduce();
```

---

### D. `packages/core/src/data-replication/TopicBasedContentReplication.ts`

Same as C.

---

### E. `packages/core/src/utils.ts` (`getMetricsInstances`)

```typescript
import { BasicAntiEntropyMetrics, NoopAntiEntropyMetrics } from './metrics';

// Add to both branches:
antiEntropy: enableMetrics ? new BasicAntiEntropyMetrics(...) : new NoopAntiEntropyMetrics(),
```

---

### F. `packages/core/src/types.ts`

```typescript
export interface DeChatMetrics {
  // ...existing
  antiEntropy: AntiEntropyMetrics;
}

export interface DeChatComponents {
  // ...existing
  /** Queryable anti-entropy state for scheduler + replication activity hooks */
  antiEntropyMetrics?: AntiEntropyMetricsStore;
}
```

---

### G. `packages/core/src/metrics/index.ts`

Export new anti-entropy metrics types and implementations.

---

### H. `packages/core/index.ts`

Export `SyncScheduler`, `STATE_VECTOR_NAMES`, `createSyncScheduler` if public API needed for tests/examples. **Default:** keep scheduling internal; export only if interop needs config overrides.

---

### I. `packages/core/tests/unit/data-convergence/AntiEntropyManager.unit.test.ts`

Add cases:

- [ ] `adaptive.enabled: false` — fixed interval, random peer (regression)
- [ ] `adaptive.enabled: true` — idle skip after K zero-hash syncs + low activity
- [ ] Floor sync forces tick when `timeSinceLastSync >= maxIntervalMs`
- [ ] Mutex skip recorded
- [ ] `stop()` clears pending `setTimeout` (no CI hang)
- [ ] Dynamic `scheduleNext` uses scheduler interval

Use `vi.useFakeTimers()` (already in file).

---

### J. Interop tests

**Files:**

- `tests/interop/InterOpScenarios.ts`
- `tests/interop/interOpTestRunner.dataSync.int.ts`
- `tests/interop/childThread/workerUitls.ts`
- `tests/interop/types.ts`

**Phase 0 goal:** Add worker-reported sync metrics to `WorkerResult` so scenarios assert convergence without blind sleep.

```typescript
// types.ts WorkerResult extension
antiEntropy?: {
  outboundAttempts: number;
  usefulSyncs: number;      // hashesDiscovered > 0
  lastSyncHashes: number;
};
```

Worker polls `components.antiEntropyMetrics?.snapshot()` before exit.

**Phase 1+:** Replace:

```typescript
const ANTI_ENTROPY_WAIT_MS = syncIntervalMs * 4 + 15_000;
```

With:

```typescript
await waitUntil(() => workerReports.every(w => w.antiEntropy?.usefulSyncs > 0), {
  timeoutMs: 120_000,
  pollMs: 2_000,
});
```

Keep sleep fallback behind `ADAPTIVE_INTEROP_STRICT=false` env for CI stability during rollout.

**Config passthrough in `workerUitls.ts`:**

```typescript
adaptive?: Partial<DeChatConfig['strategies']['synchronizer']['adaptive']>;
```

---

### K. `docs/adr/0003-adaptive-anti-entropy-scheduling.md`

On implementation start: change `status: proposed` → `status: accepted`.

---

## Implementation Order

Execute in sequence; tests must stay green at each step.

### Step 0 — Planning approval

- [ ] Review this document
- [ ] Approve ADR-0003 status → accepted
- [ ] Confirm default `adaptive.enabled: false` for safe merge

### Step 1 — Foundation (metrics store, no scheduler change)

- [ ] `SlidingWindowRingBuffer`
- [ ] `PeerConvergenceTracker`, `ReplicationActivityTracker`
- [ ] `StateVectorBuilder`
- [ ] `AntiEntropyMetricsStore` + `BasicAntiEntropyMetrics` + `NoopAntiEntropyMetrics`
- [ ] Wire `getMetricsInstances` + `DeChatMetrics` type
- [ ] Unit tests for above
- [ ] **No behaviour change yet** — hooks can be no-op wired

### Step 2 — Instrumentation (Phase 0 complete)

- [ ] Instrument `AntiEntropyManager` (tick, skip, outbound timing, fetch hashes)
- [ ] Instrument inbound `onMissingHashesDiscovered`
- [ ] Hook `onLocalDataProduced` in both replication engines
- [ ] Expose `components.antiEntropyMetrics`
- [ ] Unit tests for instrumentation + `AntiEntropyManager` metrics side effects
- [ ] Interop: worker snapshot fields (read-only); still use sleep-based wait

### Step 3 — Scheduler interface + fixed mode refactor

- [ ] `scheduling/types.ts`, `FixedSyncScheduler`, `createSyncScheduler`
- [ ] Replace `setInterval` → `scheduleNext` in manager
- [ ] `adaptive.enabled: false` uses `FixedSyncScheduler` — **must be behaviour-identical** to pre-refactor
- [ ] Run full unit + interop suite — regression gate

### Step 4 — Heuristic scheduler (ADR Phase 1)

- [ ] `HeuristicSyncScheduler` — weighted peer pick
- [ ] Idle skip + floor sync
- [ ] Unit tests with fake timers
- [ ] Enable `adaptive.enabled: true` in **one** interop scenario only (feature flag)

### Step 5 — Adaptive interval (ADR Phase 2)

- [ ] `nextIntervalMs` urgency formula + jitter
- [ ] Monitor `syncAttemptDurationMs` in interop before enabling globally
- [ ] Update interop waits to metric-based polling (with sleep fallback)

### Step 6 — Verification

- [ ] `yarn workspace @dechat/core test`
- [ ] `yarn workspace @dechat/core build`
- [ ] `yarn test:int:startup`
- [ ] `yarn test:int:data-sync`
- [ ] Optional: `tests/perf/antiEntropyScheduler.bench.ts` — compare bytes/attempts fixed vs heuristic

### Step 7 — Phase 3 bandit (optional, separate PR)

- [ ] `RewardFunction`, `EpsilonGreedyPolicy`, `BanditSyncScheduler`
- [ ] `scheduler: 'bandit'` config
- [ ] Interop A/B report in `tests/perf/reports/`
- [ ] Update ADR or add ADR-0004 if ONNX pursued

---

## Verification Checklist

- [ ] `adaptive.enabled: false` — byte-identical sync behaviour to pre-change (random peer, fixed interval)
- [ ] Safety invariant 1 — trie diff / auth / replication logic untouched
- [ ] Safety invariant 2 — outbound sync at least every `maxIntervalMs` when peers connected
- [ ] Safety invariant 3 — `isSyncing` mutex preserved
- [ ] Safety invariant 4 — `SimplePeerScorer` not imported by scheduling module
- [ ] Safety invariant 5 — no peer hard-excluded (min weight 0.1)
- [ ] Safety invariant 6 — inbound sync never gated by scheduler
- [ ] `stop()` clears timeout; interop workers terminate (no hang)
- [ ] State vector indices match ADR table (stable for future ML)
- [ ] Memory bounded: `O(windowSize + peerCount)` per node

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Adaptive interval causes sync storms | `jitterMs`; monitor duration in Phase 0 before Phase 2 |
| Idle skip delays partition heal | Floor sync every `maxIntervalMs`; interop split-brain scenario |
| `setInterval` → `setTimeout` regression | Step 3 regression gate with `adaptive.enabled: false` |
| Peer churn breaks bandit arms | `DynamicArmSet` decay; min weight for new peers |
| Zero-hash reward confuses bandit | Separate converged reward (0.1) vs idle skip (dormancy) |
| Interop flakes during transition | Sleep fallback env var; enable adaptive per-scenario |
| Metrics disabled breaks scheduler | Always instantiate internal store; metrics.enabled = export only |

---

## Out of Scope

- LLM / ONNX / deep RL schedulers
- Cross-node metrics aggregation
- Per-topic / per-room state vectors (future ADR)
- `localUnsyncedDeltaSize`, `droppedPacketCount`, `peerBandwidthCapacity` (ADR deferred)
- Changing trie protocol messages or drill-down depth
- `PeerRegistry` vs `getConnections()` peer source switch
- Batch `fetchMissingData` (existing TODO in manager)
- Dial-queue adaptive intelligence (ADR defers to DialQueue/PEX)

---

## File Tree (after implementation)

```
packages/core/src/data-convergence/
├── AntiEntropyManager.ts          # modified — dynamic timer, scheduler DI
├── AntiEntropyNetworkExchange.ts  # minimal / unchanged
├── types.ts
├── PrefixTrie.ts
├── TrieBackedReplicaStore.ts
└── scheduling/
    ├── index.ts
    ├── types.ts
    ├── math.ts
    ├── SlidingWindowRingBuffer.ts
    ├── PeerConvergenceTracker.ts
    ├── ReplicationActivityTracker.ts
    ├── StateVectorBuilder.ts
    ├── AntiEntropyMetricsStore.ts
    ├── FixedSyncScheduler.ts
    ├── HeuristicSyncScheduler.ts
    └── bandit/                    # Phase 3 optional
        ├── RewardFunction.ts
        ├── EpsilonGreedyPolicy.ts
        ├── DynamicArmSet.ts
        └── BanditSyncScheduler.ts

packages/core/src/metrics/
├── interfaces/AntiEntropyMetrics.ts
├── basic/BasicAntiEntropyMetrics.ts
└── noop/NoopAntiEntropyMetrics.ts

packages/core/tests/unit/data-convergence/scheduling/
├── SlidingWindowRingBuffer.unit.test.ts
├── PeerConvergenceTracker.unit.test.ts
├── StateVectorBuilder.unit.test.ts
├── FixedSyncScheduler.unit.test.ts
├── HeuristicSyncScheduler.unit.test.ts
└── bandit/...
```

---

## Approval

**Pending.** Review gaps below; approve to begin Step 1.

### Gaps identified and resolved in this revision

| Gap | Resolution in plan |
|-----|-------------------|
| Old `todo.md` was CBOR task | Replaced with this document; CBOR marked complete in header |
| `setInterval` incompatible with dynamic interval | Recursive `scheduleNext()` specified |
| `syncIntervalMs` vs `maxIntervalMs` ambiguity | Documented migration rule |
| Metrics disabled vs scheduler state | Internal store always on; export gated by `metrics.enabled` |
| Activity rate hook location | `ReplicationActivityTracker` + replication engine hooks |
| Peer pick source | Keep `getConnections()`; TODO for PeerRegistry |
| Bandit reward for 0 hashes | Converged (+0.1) vs idle skip (separate mechanism) |
| Interop sleep brittleness | Phased: snapshot first, then poll-based wait |
| Phase 3 scope creep | Explicit optional Step 7 / separate PR |
| No new dependencies | Pure TS for Phases 0–2 and bandit |

---

## Implementation Status

- [x] Step 0 — Planning approval
- [x] Step 1 — Foundation (metrics store)
- [x] Step 2 — Instrumentation (Phase 0)
- [x] Step 3 — Scheduler refactor + fixed mode regression
- [x] Step 4 — Heuristic peer pick + idle skip (Phase 1)
- [x] Step 5 — Adaptive interval (Phase 2)
- [x] Step 6 — CI / interop verification (PR #36 green)
- [ ] Step 7 — Bandit scheduler (optional)

### Follow-up backlog (scale testing)

Deferred Testground evaluation (see [libp2p/test-plans#103](https://github.com/libp2p/test-plans/issues/103)).

| Task | Plan doc | Summary |
|------|----------|---------|
| **5.1 Tier 1** | [tasks/tier1-adaptive-interop.md](tier1-adaptive-interop.md) | Strict CI polling, richer metrics, fixed vs heuristic A/B, nightly 12/24/50-node runs — **implement next** |
| **5.2 Tier 2** | TBD (`tasks/tier2-compose-interop.md`) | Docker Compose interop — after Tier 1 nightly green |
| **Step 7 Bandit** | `todo.md` Step 7 | After Tier 1 nightly green (7 consecutive passes) |
