# `@dechat/core` interop tests

Worker-thread P2P scenarios that run real DeChat nodes. Integration tests compile to `dist/` — **always `yarn build` before interop**.

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `ADAPTIVE_INTEROP_STRICT` | `false` | Poll `hasTargetData` instead of fixed sleeps for anti-entropy scenarios |
| `INTEROP_AB_TEST` | unset | Enables fixed vs heuristic A/B test in `interOpTestRunner.adaptiveAb.int.ts` |
| `INTEROP_WRITE_REPORT_JSON` | `false` | Write JSON report to `tests/interop/reports/` |

## Commands

From repo root:

```bash
yarn build
yarn test:int:data-sync                    # full data-sync suite (PR CI)
yarn workspace @dechat/core test:int:adaptive-scale -- --nodes 12
yarn workspace @dechat/core test:int:adaptive-ab   # requires INTEROP_AB_TEST=true
```

With strict polling locally:

```bash
ADAPTIVE_INTEROP_STRICT=true yarn workspace @dechat/core test:int:data-sync
```

## CI scope

| Workflow | Tests | Strict poll | Max nodes |
|----------|-------|-------------|-----------|
| `ci.yaml` → `integration-tests-data-sync` | Full data-sync suite | Yes | 6 (default) |
| `interop-scale-nightly.yml` | Adaptive scale + A/B | Yes | 12, 24, 50 |

## Anti-entropy report fields

When data sync is enabled, reports include:

- **Late joiner:** `usefulSyncs`, `convergenceMs`, `idleSkips`, `floorSyncForces`, `scheduledTicks`
- **Producers (aggregate):** total idle skips, outbound attempts, floor sync forces

## Troubleshooting

- **Mesh not formed:** `computeMeshStabilizeMs` in `interopTiming.ts` scales stabilize/replicate windows with node count
- **Strict poll timeout:** scales via `computeLateJoinerPollTimeoutMs` (50-node poll is 560s); check worker logs and `set_expected_hashes` ordering
- **Worker hang:** ensure `terminateWorkers` runs; integration tests must clean up all worker threads

Timing helpers only extend wait/poll windows. Scale assertions still require `hasTargetData`, producer-sized `replicaCount`, and `usefulSyncs > 0`.

Late-joiner scenarios defer all passive replication ingest (gossip, direct, and replication-protocol announce/content) for the worker's lifetime when `suppressReplicationIngest` is set. `set_expected_hashes` only starts the convergence clock; anti-entropy's explicit `requestMissingData` path is the sole ingest route so `usefulSyncs > 0` reflects real sync work.
