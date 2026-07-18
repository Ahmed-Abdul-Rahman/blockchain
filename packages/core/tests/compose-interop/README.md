# Compose interop (Tier 2)

Multi-container DeChat convergence tests using Docker Compose + Redis barriers.

Reuses `nodeRunner` from worker-thread interop via a Redis transport. Tier 1 worker interop remains the PR CI gate; Compose is for realistic TCP / later netem profiles.

## Prerequisites

- Docker 24+ with Compose v2 (local) **or** GitHub Actions (`Compose Interop` workflow)
- Repo built: `yarn workspace @dechat/core build` (orchestrator runs on the host from `dist/`)
- Free host port `6379` (Redis) when running locally

## CI (no local Docker required)

Workflow: [`.github/workflows/compose-interop.yml`](../../../../.github/workflows/compose-interop.yml)

| Trigger | When |
|---------|------|
| `pull_request` | Changes under `compose-interop/` / `nodeRunner` / this workflow (path-filtered) |
| `workflow_dispatch` | Manual run from Actions tab (optional `compose_nodes`) |

On PR #43 (and future Compose PRs), open the **Compose Interop** check — it builds the image on `ubuntu-latest`, runs `test:compose:late-joiner`, uploads `reports/` artifacts, and tears down containers.

## Quick start — late joiner (lan)

From repo root:

```bash
yarn workspace @dechat/core build
yarn workspace @dechat/core test:compose:late-joiner
```

Defaults: **6 producers + 1 late joiner**, `adaptive.enabled=true`, `scheduler=heuristic`.

Overrides:

```bash
COMPOSE_NODES=7 \
ADAPTIVE_ENABLED=true \
SCHEDULER=heuristic \
SYNC_INTERVAL_MS=15000 \
yarn workspace @dechat/core test:compose:late-joiner
```

## What the script does

1. Builds the Compose node image
2. Starts Redis
3. Starts `dechat-node-0…N-1` on the Compose network (`ADVERTISE_HOST=dechat-node-{i}`)
4. Runs the host orchestrator (`scenarios/late-joiner-adaptive.ts`)
5. Tears down containers + volumes (`docker compose down -v`)

## Layout

| Path | Role |
|------|------|
| `composeNodeMain.ts` | Container entry — Redis transport → `startNodeRunner` |
| `composeOrchestrator.ts` | Host control plane (commands / barriers) |
| `scenarios/late-joiner-adaptive.ts` | P0 late-joiner choreography |
| `scripts/run-scenario.sh` | Docker lifecycle + orchestrator |
| `reports/` | JSON reports (gitignored) |

## Debugging

```bash
docker logs dechat-node-0
docker compose -p dechat-compose-interop -f packages/core/tests/compose-interop/docker-compose.yml logs redis
LOG_LEVEL=debug yarn workspace @dechat/core test:compose:late-joiner
```

## Out of scope (later PRs)

- Netem `wan` / `lossy` (PR C)
- Nightly GH Actions workflow (PR D)
- Split-brain / partition heal (PR D)
