# Compose interop (Tier 2)

Multi-container DeChat convergence tests using Docker Compose + Redis barriers + optional `tc netem` / `iptables` partitions.

Reuses `nodeRunner` from worker-thread interop via a Redis transport. Tier 1 worker interop remains the PR CI gate; Compose is for realistic TCP / netem / partition profiles.

## Prerequisites

- Docker 24+ with Compose v2 (local) **or** GitHub Actions
- Repo built: `yarn workspace @dechat/core build` (orchestrator runs on the host from `dist/`)
- Free host port `6379` (Redis) when running locally
- Netem / partition need `NET_ADMIN` in containers (granted by `run-scenario.sh`). Shaping and iptables run **inside** Linux containers — works on Docker Desktop without host `tc`/`iptables`.

## CI

| Workflow | Trigger | Jobs |
|----------|---------|------|
| [Compose Interop](../../../../.github/workflows/compose-interop.yml) | Path-filtered PR + dispatch | lan + wan late-joiner, A/B, **split-brain (6)**; optional `run_wan_vs_lan` |
| [Compose Interop Nightly](../../../../.github/workflows/compose-interop-nightly.yml) | `0 4 * * *` + dispatch | **12-node** lan, **12-node** wan, **6-node** split-brain |

Artifacts upload `packages/core/tests/compose-interop/reports/`.

### Flake policy (promote to PR gate)

Compose stays **non-required** until soak criteria are met:

1. Run nightly on `develop` for **≥ 7 consecutive nights**
2. Aggregate flake rate across nightly jobs **&lt; 5%**
3. P0 late-joiner (lan, 12 nodes) wall time typically **&lt; 15 minutes** on `ubuntu-latest`
4. Then consider making a single Compose smoke job required on PRs (still keep 12-node / wan / A/B / split-brain as nightly)

Until then: Tier 1 worker-thread interop remains the correctness gate.

## Quick start — late joiner (lan)

```bash
yarn workspace @dechat/core build
yarn workspace @dechat/core test:compose:late-joiner
```

Defaults: **6 producers + 1 late joiner**, `adaptive.enabled=true`, `scheduler=heuristic`, `NETEM_PROFILE=lan`.

## Split-brain heal

Even node count (default **6**): partitions A/B mesh only within cohort, `iptables` DROP A↔B, each side produces, heal (flush + cross-dial), assert full hash union on every node.

```bash
yarn workspace @dechat/core test:compose:split-brain
COMPOSE_NODES=8 yarn workspace @dechat/core test:compose:split-brain
```

## A/B — fixed vs heuristic

```bash
yarn workspace @dechat/core test:compose:ab
```

Report includes `abComparison` (heuristic `producerIdleSkipsTotal` must exceed fixed).

## Netem profiles

| Profile | Shaping | Yarn script |
|---------|---------|-------------|
| `lan` | none | `test:compose:late-joiner` |
| `wan` | `delay 50ms 10ms rate 10mbit` | `test:compose:late-joiner:wan` |
| `lossy` | `loss 1% delay 100ms` | `test:compose:late-joiner:lossy` |

## WAN vs LAN wall-time check

```bash
yarn workspace @dechat/core test:compose:wan-vs-lan
WAN_MAX_LAN_MULTIPLIER=3 yarn workspace @dechat/core test:compose:wan-vs-lan
```

## Env overrides

| Env | Meaning |
|-----|---------|
| `COMPOSE_NODES` | Late-joiner: producers + 1; split-brain: even total (default 6) |
| `COMPOSE_ROLE_MODE` | `late-joiner` (default) \| `all-producers` |
| `NETEM_PROFILE` | `lan` \| `wan` \| `lossy` |
| `COMPOSE_REPORT_PATH` | Stable report path |
| `WAN_MAX_LAN_MULTIPLIER` | WAN wall budget vs LAN (default 2) |
| `COMPOSE_HEAL_CONNECT_MS` | Post-heal mesh settle (default 45000) |

## Layout

| Path | Role |
|------|------|
| `composeNodeMain.ts` | Redis transport → `startNodeRunner` |
| `scripts/apply-netem.sh` | Static `tc` at container start |
| `scripts/apply-partition.sh` | Mid-run iptables DROP / flush (host → `docker exec`) |
| `scenarios/late-joiner-adaptive.ts` | P0 late-joiner |
| `scenarios/split-brain.ts` | P1 partition heal |
| `scenarios/dormant-room-ab.ts` | A/B merge + idle-skip assert |
| `reports/` | JSON reports (gitignored) |

## Debugging

```bash
docker logs dechat-node-0
docker exec dechat-node-0 tc qdisc show
docker exec dechat-node-0 iptables -L -n
LOG_LEVEL=debug yarn workspace @dechat/core test:compose:split-brain
```
