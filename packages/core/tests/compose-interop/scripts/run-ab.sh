#!/usr/bin/env bash
# Dual-run Compose late-joiner: fixed then heuristic; merge A/B report + idle-skip assert.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CORE_DIR="$(cd "${COMPOSE_DIR}/../.." && pwd)"
REPORTS_DIR="${COMPOSE_DIR}/reports"
mkdir -p "${REPORTS_DIR}"

COMPOSE_NODES="${COMPOSE_NODES:-7}"
SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-15000}"
NETEM_PROFILE="${NETEM_PROFILE:-lan}"
STAMP="$(date +%Y%m%dT%H%M%S)"
BASE_NETWORK_ID="${NETWORK_ID:-compose-ab-${STAMP}}"

FIXED_REPORT="${REPORTS_DIR}/compose-ab-fixed-${STAMP}.json"
HEURISTIC_REPORT="${REPORTS_DIR}/compose-ab-heuristic-${STAMP}.json"
AB_REPORT="${REPORTS_DIR}/compose-dormant-room-ab-${STAMP}.json"

# ≥2 sync intervals after convergence so heuristic producers idle-skip.
DORMANT_SETTLE_MS="${COMPOSE_DORMANT_SETTLE_MS:-$((SYNC_INTERVAL_MS * 3))}"

echo "[compose-ab] leg 1/2 fixed (adaptive=false) nodes=${COMPOSE_NODES} netem=${NETEM_PROFILE}"
COMPOSE_NODES="${COMPOSE_NODES}" \
  ADAPTIVE_ENABLED=false \
  SCHEDULER=fixed \
  SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS}" \
  NETEM_PROFILE="${NETEM_PROFILE}" \
  NETWORK_ID="${BASE_NETWORK_ID}-fixed" \
  COMPOSE_REPORT_PATH="${FIXED_REPORT}" \
  COMPOSE_DORMANT_SETTLE_MS="${DORMANT_SETTLE_MS}" \
  bash "${SCRIPT_DIR}/run-scenario.sh"

echo "[compose-ab] leg 2/2 heuristic (adaptive=true) nodes=${COMPOSE_NODES} netem=${NETEM_PROFILE}"
COMPOSE_NODES="${COMPOSE_NODES}" \
  ADAPTIVE_ENABLED=true \
  SCHEDULER=heuristic \
  SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS}" \
  NETEM_PROFILE="${NETEM_PROFILE}" \
  NETWORK_ID="${BASE_NETWORK_ID}-heuristic" \
  COMPOSE_REPORT_PATH="${HEURISTIC_REPORT}" \
  COMPOSE_DORMANT_SETTLE_MS="${DORMANT_SETTLE_MS}" \
  bash "${SCRIPT_DIR}/run-scenario.sh"

echo "[compose-ab] merging A/B report"
cd "${CORE_DIR}"
COMPOSE_AB_FIXED_REPORT="${FIXED_REPORT}" \
  COMPOSE_AB_HEURISTIC_REPORT="${HEURISTIC_REPORT}" \
  COMPOSE_REPORT_PATH="${AB_REPORT}" \
  NODE_ENV=perf \
  node dist/tests/compose-interop/scenarios/dormant-room-ab.js

echo "[compose-ab] passed → ${AB_REPORT}"
