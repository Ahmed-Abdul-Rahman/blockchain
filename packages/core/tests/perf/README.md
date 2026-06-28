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
