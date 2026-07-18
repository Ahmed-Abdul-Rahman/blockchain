# Compose interop (Tier 2)

Multi-container DeChat convergence tests using Docker Compose + Redis barriers + optional `tc netem`.

Reuses `nodeRunner` from worker-thread interop via a Redis transport. Tier 1 worker interop remains the PR CI gate; Compose is for realistic TCP / netem profiles.

## Prerequisites

- Docker 24+ with Compose v2 (local) **or** GitHub Actions (`Compose Interop` workflow)
- Repo built: `yarn workspace @dechat/core build` (orchestrator runs on the host from `dist/`)
- Free host port `6379` (Redis) when running locally
- Netem profiles need `NET_ADMIN` in containers (granted by `run-scenario.sh`). Shaping runs **inside** Linux containers — works on Docker Desktop (macOS/Windows) without host `tc`.

## CI (no local Docker required)

Workflow: [`.github/workflows/compose-interop.yml`](../../../../.github/workflows/compose-interop.yml)

| Trigger | When |
|---------|------|
| `pull_request` | Changes under `compose-interop/` / `nodeRunner` / this workflow (path-filtered) — **lan + wan late-joiner** and **fixed/heuristic A/B** (parallel jobs) |
| `workflow_dispatch` | Same PR jobs; optional `run_wan_vs_lan=true` for the ≤2× wall-time check |

Artifacts: `compose-late-joiner-lan`, `compose-late-joiner-wan`, `compose-dormant-room-ab` (and `compose-wan-vs-lan` when dispatched).

Nightly 12-node soak is PR D.

## Quick start — late joiner (lan)

From repo root:

```bash
yarn workspace @dechat/core build
yarn workspace @dechat/core test:compose:late-joiner
```

Defaults: **6 producers + 1 late joiner**, `adaptive.enabled=true`, `scheduler=heuristic`, `NETEM_PROFILE=lan`.

## A/B — fixed vs heuristic (dormant producers)

Runs late-joiner twice (isolated `NETWORK_ID`s), then merges reports and asserts
`heuristic.producerIdleSkipsTotal > fixed.producerIdleSkipsTotal`.

```bash
yarn workspace @dechat/core test:compose:ab
```

Report: `tests/compose-interop/reports/compose-dormant-room-ab-*.json` (includes `abComparison`).

**Wall-time trade-off:** heuristic often spends fewer producer outbound attempts on a dormant mesh after settle; late-joiner convergence wall time may be similar or slightly higher than fixed depending on sync cadence. Compare `fixedWallMs` / `heuristicWallMs` and `producerOutboundAttemptsTotal` in the A/B section of the report — do not treat either wall time as a hard SLO in v1.

## Netem profiles

| Profile | Shaping | Yarn script |
|---------|---------|-------------|
| `lan` | none | `test:compose:late-joiner` |
| `wan` | `delay 50ms 10ms rate 10mbit` | `test:compose:late-joiner:wan` |
| `lossy` | `loss 1% delay 100ms` | `test:compose:late-joiner:lossy` |

Override any run:

```bash
NETEM_PROFILE=wan yarn workspace @dechat/core test:compose:late-joiner
```

Profiles live in `netem/*.env` and are applied once at container start via `scripts/apply-netem.sh` (requires `iproute2` in the image).

## WAN vs LAN wall-time check

Runs lan then wan late-joiner; fails if `wanWallMs > WAN_MAX_LAN_MULTIPLIER × lanWallMs` (default **2**).

```bash
yarn workspace @dechat/core test:compose:wan-vs-lan

# Relax or skip for debugging:
WAN_MAX_LAN_MULTIPLIER=3 yarn workspace @dechat/core test:compose:wan-vs-lan
SKIP_WAN_MULTIPLIER=true yarn workspace @dechat/core test:compose:wan-vs-lan
```

## Env overrides

```bash
COMPOSE_NODES=7 \
ADAPTIVE_ENABLED=true \
SCHEDULER=heuristic \
SYNC_INTERVAL_MS=15000 \
NETEM_PROFILE=lan \
COMPOSE_REPORT_PATH=/tmp/compose-report.json \
yarn workspace @dechat/core test:compose:late-joiner
```

| Env | Meaning |
|-----|---------|
| `COMPOSE_NODES` | Producers + 1 late joiner (default 7) |
| `NETEM_PROFILE` | `lan` \| `wan` \| `lossy` |
| `COMPOSE_REPORT_PATH` | Stable report path (used by A/B / wan-vs-lan wrappers) |
| `WAN_MAX_LAN_MULTIPLIER` | WAN wall budget vs LAN (default 2) |
| `SKIP_WAN_MULTIPLIER` | Skip wall assert (`true` / `1`) |

## What `run-scenario.sh` does

1. Builds the Compose node image (includes `iproute2`)
2. Starts Redis
3. Starts `dechat-node-0…N-1` with `--cap-add=NET_ADMIN` and netem env
4. Entrypoint applies netem, then runs Redis → `nodeRunner`
5. Host orchestrator (`scenarios/late-joiner-adaptive.ts`)
6. Tears down containers + volumes (`docker compose down -v`)

## Layout

| Path | Role |
|------|------|
| `composeNodeMain.ts` | Container entry logic — Redis transport → `startNodeRunner` |
| `scripts/docker-entrypoint.sh` | Netem then node main |
| `scripts/apply-netem.sh` | Static `tc qdisc` from profile |
| `netem/*.env` | Profile definitions |
| `composeOrchestrator.ts` | Host control plane |
| `scenarios/late-joiner-adaptive.ts` | P0 late-joiner choreography |
| `scenarios/dormant-room-ab.ts` | Host-side A/B merge + idle-skip assert |
| `scenarios/wan-vs-lan.ts` | Host-side WAN≤N×LAN assert |
| `scripts/run-ab.sh` / `run-wan-vs-lan.sh` | Dual-run wrappers |
| `reports/` | JSON reports (gitignored) |

## Debugging

```bash
docker logs dechat-node-0
docker exec dechat-node-0 tc qdisc show
docker compose -p dechat-compose-interop -f packages/core/tests/compose-interop/docker-compose.yml logs redis
LOG_LEVEL=debug yarn workspace @dechat/core test:compose:late-joiner
```

## Out of scope (later PRs)

- Nightly GH Actions schedule / 12-node wan soak (PR D)
- Split-brain / mid-run `iptables` partition heal (PR D)
