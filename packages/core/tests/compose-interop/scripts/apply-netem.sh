#!/usr/bin/env bash
# Apply static tc netem profile to the container's default egress interface.
# Intended to run once at container start (NET_ADMIN required). Profile `lan` is a no-op.
set -euo pipefail

NETEM_PROFILE="${NETEM_PROFILE:-lan}"
NETEM_OPTS="${NETEM_OPTS:-}"

if [[ "${NETEM_PROFILE}" == "lan" ]] || [[ -z "${NETEM_OPTS// }" ]]; then
  echo "[netem] profile=${NETEM_PROFILE} (no shaping)"
  exit 0
fi

if ! command -v tc >/dev/null 2>&1; then
  echo "[netem] tc not found — install iproute2 in the image" >&2
  exit 1
fi

IFACE="${NETEM_IFACE:-}"
if [[ -z "${IFACE}" ]]; then
  IFACE="$(ip -o -4 route show to default 2>/dev/null | awk '{print $5; exit}' || true)"
fi
if [[ -z "${IFACE}" ]]; then
  IFACE="$(ip -o link show 2>/dev/null | awk -F': ' '$2 != "lo" {print $2; exit}' | cut -d@ -f1 || true)"
fi
if [[ -z "${IFACE}" ]]; then
  echo "[netem] could not detect egress interface" >&2
  exit 1
fi

# Replace any existing root qdisc so restarts are idempotent.
tc qdisc del dev "${IFACE}" root 2>/dev/null || true
# shellcheck disable=SC2086
tc qdisc add dev "${IFACE}" root netem ${NETEM_OPTS}

echo "[netem] profile=${NETEM_PROFILE} iface=${IFACE} opts=${NETEM_OPTS}"
tc qdisc show dev "${IFACE}" || true
