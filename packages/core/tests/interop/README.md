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
- **Strict poll timeout:** scales via `computeLateJoinerPollTimeoutMs`; check worker logs and `set_expected_hashes` ordering
- **Worker hang:** ensure `terminateWorkers` runs; integration tests must clean up all worker threads

Late-joiner scenarios defer gossip replication ingest until `set_expected_hashes`, then dial producers explicitly (no mDNS) so convergence is attributed to anti-entropy rather than live gossip during connect.
