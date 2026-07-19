#!/usr/bin/env bash
# Compose split-brain: even N producers, iptables partition, heal, union converge.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COMPOSE_NODES="${COMPOSE_NODES:-6}"
ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED:-true}"
SCHEDULER="${SCHEDULER:-heuristic}"
SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-15000}"
NETEM_PROFILE="${NETEM_PROFILE:-lan}"

if (( COMPOSE_NODES < 4 || COMPOSE_NODES % 2 != 0 )); then
  echo "[compose-split-brain] COMPOSE_NODES must be even and >= 4 (got ${COMPOSE_NODES})" >&2
  exit 1
fi

echo "[compose-split-brain] nodes=${COMPOSE_NODES} adaptive=${ADAPTIVE_ENABLED} scheduler=${SCHEDULER} netem=${NETEM_PROFILE}"

COMPOSE_NODES="${COMPOSE_NODES}" \
  ADAPTIVE_ENABLED="${ADAPTIVE_ENABLED}" \
  SCHEDULER="${SCHEDULER}" \
  SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS}" \
  NETEM_PROFILE="${NETEM_PROFILE}" \
  COMPOSE_ROLE_MODE=all-producers \
  COMPOSE_ORCHESTRATOR=scenarios/split-brain.js \
  COMPOSE_DORMANT_SETTLE_MS="${COMPOSE_DORMANT_SETTLE_MS:-0}" \
  bash "${SCRIPT_DIR}/run-scenario.sh"
