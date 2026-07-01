# Anti-Entropy Scheduler A/B Report

Generated: 2026-06-30T19:48:54.848Z

Scenario: **dormant-room-after-convergence** (20 scheduling ticks after 3 zero-hash syncs)

| Metric | Fixed | Heuristic | Delta |
| --- | ---: | ---: | ---: |
| Outbound attempts | 20 | 0 | -20 |
| Idle skips | 0 | 20 | 20 |
| Floor sync overrides | 0 | 0 | 0 |
| Total interval (ms) | 300000 | 265000 | -35000 |

**Attempt reduction (heuristic vs fixed):** 100.0%

## Interpretation

- **Idle skips > 0 (heuristic only)** confirms dormant-room skip policy is active.
- **Lower outbound attempts (heuristic)** confirms bandwidth savings vs fixed polling.
- **Floor sync overrides > 0 (heuristic)** confirms eventual-consistency ceiling is enforced.
