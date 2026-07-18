#!/usr/bin/env bash
# Start Redis + N Compose nodes, run late-joiner orchestrator on the host, tear down.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CORE_DIR="$(cd "${COMPOSE_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${CORE_DIR}/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"
PROJECT="dechat-compose-interop"
NETWORK_NAME="dechat-compose-interop"

COMPOSE_NODES="${COMPOSE_NODES:-7}"
ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED:-true}"
SCHEDULER="${SCHEDULER:-heuristic}"
SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-15000}"
NETWORK_ID="${NETWORK_ID:-compose-interop-$(date +%s)}"
LISTEN_PORT="${LISTEN_PORT:-4001}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

cleanup() {
  echo "[compose] teardown"
  for i in $(seq 0 $((COMPOSE_NODES - 1))); do
    docker rm -f "dechat-node-${i}" >/dev/null 2>&1 || true
  done
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "${REPO_ROOT}"

echo "[compose] build image + start redis"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" build node
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d redis

echo "[compose] waiting for redis"
for _ in $(seq 1 60); do
  if docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 1
done

# Image name from compose project (see `docker compose images`).
NODE_IMAGE="${PROJECT}-node"
PRODUCER_COUNT=$((COMPOSE_NODES - 1))

echo "[compose] starting ${PRODUCER_COUNT} producers + 1 late joiner (total=${COMPOSE_NODES})"
for i in $(seq 0 $((COMPOSE_NODES - 1))); do
  if [[ "${i}" -eq "${PRODUCER_COUNT}" ]]; then
    ROLE="late-joiner"
  else
    ROLE="producer"
  fi

  # Use docker run (not compose run): need --network-alias for dns4 advertise hosts.
  docker run -d \
    --name "dechat-node-${i}" \
    --hostname "dechat-node-${i}" \
    --network "${NETWORK_NAME}" \
    --network-alias "dechat-node-${i}" \
    -e NODE_INDEX="${i}" \
    -e TOTAL_NODES="${COMPOSE_NODES}" \
    -e ROLE="${ROLE}" \
    -e ADVERTISE_HOST="dechat-node-${i}" \
    -e LISTEN_PORT="${LISTEN_PORT}" \
    -e NETWORK_ID="${NETWORK_ID}" \
    -e ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED}" \
    -e SCHEDULER="${SCHEDULER}" \
    -e SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS}" \
    -e ENABLE_MDNS=false \
    -e REDIS_URL=redis://redis:6379 \
    -e LOG_LEVEL="${LOG_LEVEL:-INFO}" \
    -e NODE_ENV=perf \
    "${NODE_IMAGE}" >/dev/null

  echo "[compose] started dechat-node-${i} role=${ROLE}"
done

export COMPOSE_NODES ADAPTIVE_ENABLED SCHEDULER SYNC_INTERVAL_MS
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"

echo "[compose] running orchestrator against ${REDIS_URL}"
cd "${CORE_DIR}"
NODE_ENV=perf LOG_LEVEL=INFO node dist/tests/compose-interop/scenarios/late-joiner-adaptive.js

echo "[compose] scenario passed"
