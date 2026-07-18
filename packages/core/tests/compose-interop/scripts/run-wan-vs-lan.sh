#!/usr/bin/env bash
# Run late-joiner on lan then wan; assert wan wall ≤ WAN_MAX_LAN_MULTIPLIER × lan (default 2).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CORE_DIR="$(cd "${COMPOSE_DIR}/../.." && pwd)"
REPORTS_DIR="${COMPOSE_DIR}/reports"
mkdir -p "${REPORTS_DIR}"

COMPOSE_NODES="${COMPOSE_NODES:-7}"
ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED:-true}"
SCHEDULER="${SCHEDULER:-heuristic}"
SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-15000}"
WAN_MAX_LAN_MULTIPLIER="${WAN_MAX_LAN_MULTIPLIER:-2}"
SKIP_WAN_MULTIPLIER="${SKIP_WAN_MULTIPLIER:-false}"
STAMP="$(date +%Y%m%dT%H%M%S)"
BASE_NETWORK_ID="${NETWORK_ID:-compose-wan-lan-${STAMP}}"

LAN_REPORT="${REPORTS_DIR}/compose-late-joiner-lan-${STAMP}.json"
WAN_REPORT="${REPORTS_DIR}/compose-late-joiner-wan-${STAMP}.json"
COMPARE_REPORT="${REPORTS_DIR}/compose-wan-vs-lan-${STAMP}.json"

echo "[compose-wan-lan] leg 1/2 lan"
COMPOSE_NODES="${COMPOSE_NODES}" \
  ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED}" \
  SCHEDULER="${SCHEDULER}" \
  SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS}" \
  NETEM_PROFILE=lan \
  NETWORK_ID="${BASE_NETWORK_ID}-lan" \
  COMPOSE_REPORT_PATH="${LAN_REPORT}" \
  bash "${SCRIPT_DIR}/run-scenario.sh"

echo "[compose-wan-lan] leg 2/2 wan"
COMPOSE_NODES="${COMPOSE_NODES}" \
  ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED}" \
  SCHEDULER="${SCHEDULER}" \
  SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS}" \
  NETEM_PROFILE=wan \
  NETWORK_ID="${BASE_NETWORK_ID}-wan" \
  COMPOSE_REPORT_PATH="${WAN_REPORT}" \
  bash "${SCRIPT_DIR}/run-scenario.sh"

echo "[compose-wan-lan] asserting wall-time multiplier=${WAN_MAX_LAN_MULTIPLIER} (skip=${SKIP_WAN_MULTIPLIER})"
cd "${CORE_DIR}"
WAN_MAX_LAN_MULTIPLIER="${WAN_MAX_LAN_MULTIPLIER}" \
  SKIP_WAN_MULTIPLIER="${SKIP_WAN_MULTIPLIER}" \
  COMPOSE_LAN_REPORT="${LAN_REPORT}" \
  COMPOSE_WAN_REPORT="${WAN_REPORT}" \
  COMPOSE_REPORT_PATH="${COMPARE_REPORT}" \
  NODE_ENV=perf \
  node dist/tests/compose-interop/scenarios/wan-vs-lan.js

echo "[compose-wan-lan] passed → ${COMPARE_REPORT}"
