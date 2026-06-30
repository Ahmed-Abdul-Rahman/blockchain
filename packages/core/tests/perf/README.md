# `@dechat/core` performance benchmarks

Opt-in benchmarks for comparing wire codecs. These are **not** part of `yarn test`.

## Wire codec benchmark (JSON vs CBOR)

```bash
yarn workspace @dechat/core bench:wire
```

After build:

```bash
yarn workspace @dechat/core build
yarn workspace @dechat/core bench:wire:dist
```

### What it measures

| Dimension | Description |
| --- | --- |
| Wire size | Serialized frame size on the network |
| Serialize / deserialize throughput | ops/sec and p99 latency |
| Event-loop delay | `monitorEventLoopDelay` while decoding repeatedly on the main thread |

### Payloads

- `propagated-message-1kb` — GossipSub-style message
- `propagated-message-8kb` — larger chat payload
- `replication-content-64kb` — replication blob
- `replication-content-256kb` — storm-sized replication blob

### Reports

Markdown reports are written to:

- `tests/perf/reports/wire-codec-report-latest.md`
- `tests/perf/reports/wire-codec-report-<timestamp>.md`

Commit `wire-codec-report-latest.md` when documenting a PR performance win.

## Anti-entropy scheduler A/B benchmark (fixed vs heuristic)

Simulates a **dormant converged room** and compares fixed vs heuristic scheduling decisions (no live P2P).

```bash
yarn workspace @dechat/core bench:anti-entropy
```

Optional: `BENCH_TICK_COUNT=30 yarn workspace @dechat/core bench:anti-entropy`

### What it measures

| Metric | Meaning |
| --- | --- |
| Outbound attempts | Sync attempts that would run (not idle-skipped) |
| Idle skips | Ticks skipped because room is dormant |
| Floor sync overrides | Forced syncs at maxIntervalMs ceiling |
| Total interval (ms) | Sum of computed delays (bandwidth proxy) |

Reports are written to `tests/perf/reports/anti-entropy-scheduler-report-latest.md`.
