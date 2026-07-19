#!/usr/bin/env bash
# Start Redis + N Compose nodes, run late-joiner orchestrator on the host, tear down.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CORE_DIR="$(cd "${COMPOSE_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${CORE_DIR}/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"
PROJECT="dechat-compose-interop"
NETWORK_NAME="dechat-interop-net"

COMPOSE_NODES="${COMPOSE_NODES:-7}"
ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED:-true}"
SCHEDULER="${SCHEDULER:-heuristic}"
SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-15000}"
NETWORK_ID="${NETWORK_ID:-compose-interop-$(date +%s)}"
LISTEN_PORT="${LISTEN_PORT:-4001}"
NETEM_PROFILE="${NETEM_PROFILE:-lan}"
COMPOSE_ORCHESTRATOR="${COMPOSE_ORCHESTRATOR:-scenarios/late-joiner-adaptive.js}"
# late-joiner: last node is ROLE=late-joiner; all-producers: every node is ROLE=producer (split-brain).
COMPOSE_ROLE_MODE="${COMPOSE_ROLE_MODE:-late-joiner}"

# Load static netem profile (NETEM_OPTS) when present.
NETEM_ENV_FILE="${COMPOSE_DIR}/netem/${NETEM_PROFILE}.env"
if [[ -f "${NETEM_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1091
  source "${NETEM_ENV_FILE}"
  set +a
fi
NETEM_OPTS="${NETEM_OPTS:-}"

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

echo "[compose] build image + start redis (netem=${NETEM_PROFILE})"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" build node
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d redis

echo "[compose] waiting for redis"
for _ in $(seq 1 60); do
  if docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 1
done

# Prefer the explicit compose network name; fall back to whatever redis joined.
REDIS_CID="$(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" ps -q redis)"
if [[ -n "${REDIS_CID}" ]]; then
  DETECTED_NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "${REDIS_CID}" | head -1 | tr -d '\r')"
  if [[ -n "${DETECTED_NET}" ]]; then
    NETWORK_NAME="${DETECTED_NET}"
  fi
fi
echo "[compose] using network ${NETWORK_NAME}"

# Image name from compose project (see `docker compose images`).
NODE_IMAGE="${PROJECT}-node"
PRODUCER_COUNT=$((COMPOSE_NODES - 1))

if [[ "${COMPOSE_ROLE_MODE}" == "all-producers" ]]; then
  echo "[compose] starting ${COMPOSE_NODES} producers (role-mode=all-producers)"
else
  echo "[compose] starting ${PRODUCER_COUNT} producers + 1 late joiner (total=${COMPOSE_NODES})"
fi
for i in $(seq 0 $((COMPOSE_NODES - 1))); do
  if [[ "${COMPOSE_ROLE_MODE}" == "all-producers" ]]; then
    ROLE="producer"
  elif [[ "${i}" -eq "${PRODUCER_COUNT}" ]]; then
    ROLE="late-joiner"
  else
    ROLE="producer"
  fi

  # Use docker run (not compose run): need --network-alias for dns4 advertise hosts.
  # NET_ADMIN required for tc netem inside the container (lan is a no-op).
  docker run -d \
    --name "dechat-node-${i}" \
    --hostname "dechat-node-${i}" \
    --network "${NETWORK_NAME}" \
    --network-alias "dechat-node-${i}" \
    --cap-add=NET_ADMIN \
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
    -e NETEM_PROFILE="${NETEM_PROFILE}" \
    -e NETEM_OPTS="${NETEM_OPTS}" \
    "${NODE_IMAGE}" >/dev/null

  echo "[compose] started dechat-node-${i} role=${ROLE}"
done

export COMPOSE_NODES ADAPTIVE_ENABLED SCHEDULER SYNC_INTERVAL_MS NETEM_PROFILE
export COMPOSE_DORMANT_SETTLE_MS="${COMPOSE_DORMANT_SETTLE_MS:-$((SYNC_INTERVAL_MS * 2))}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
# Preserve caller-provided report path when set (A/B / wan-vs-lan wrappers).
if [[ -n "${COMPOSE_REPORT_PATH:-}" ]]; then
  export COMPOSE_REPORT_PATH
fi

echo "[compose] running orchestrator ${COMPOSE_ORCHESTRATOR} against ${REDIS_URL}"
cd "${CORE_DIR}"
NODE_ENV=perf LOG_LEVEL=INFO node "dist/tests/compose-interop/${COMPOSE_ORCHESTRATOR}"

echo "[compose] scenario passed"
