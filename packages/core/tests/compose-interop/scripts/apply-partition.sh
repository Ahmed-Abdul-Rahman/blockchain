#!/usr/bin/env bash
# Mid-run partition / heal via iptables DROP between Compose node cohorts.
# Usage: apply-partition.sh partition|heal
# Env: COMPOSE_NODES (even, >= 4). Containers named dechat-node-0..N-1.
set -euo pipefail

ACTION="${1:-}"
COMPOSE_NODES="${COMPOSE_NODES:-6}"

if [[ "${ACTION}" != "partition" && "${ACTION}" != "heal" ]]; then
  echo "usage: $0 partition|heal" >&2
  exit 2
fi

if (( COMPOSE_NODES < 4 || COMPOSE_NODES % 2 != 0 )); then
  echo "[partition] COMPOSE_NODES must be even and >= 4 (got ${COMPOSE_NODES})" >&2
  exit 1
fi

HALF=$((COMPOSE_NODES / 2))

container_ip() {
  local index="$1"
  local ip
  ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "dechat-node-${index}" 2>/dev/null | tr -d '\r')"
  if [[ -z "${ip}" ]]; then
    echo "[partition] could not resolve IP for dechat-node-${index}" >&2
    exit 1
  fi
  echo "${ip}"
}

drop_pair() {
  local from_index="$1"
  local to_ip="$2"
  # Idempotent: skip if rule already present.
  if ! docker exec "dechat-node-${from_index}" iptables -C OUTPUT -d "${to_ip}" -j DROP 2>/dev/null; then
    docker exec "dechat-node-${from_index}" iptables -A OUTPUT -d "${to_ip}" -j DROP
  fi
  if ! docker exec "dechat-node-${from_index}" iptables -C INPUT -s "${to_ip}" -j DROP 2>/dev/null; then
    docker exec "dechat-node-${from_index}" iptables -A INPUT -s "${to_ip}" -j DROP
  fi
}

if [[ "${ACTION}" == "heal" ]]; then
  echo "[partition] heal: flushing INPUT/OUTPUT on ${COMPOSE_NODES} nodes"
  for i in $(seq 0 $((COMPOSE_NODES - 1))); do
    docker exec "dechat-node-${i}" iptables -F INPUT 2>/dev/null || true
    docker exec "dechat-node-${i}" iptables -F OUTPUT 2>/dev/null || true
  done
  echo "[partition] heal complete"
  exit 0
fi

declare -a IPS=()
for i in $(seq 0 $((COMPOSE_NODES - 1))); do
  IPS+=("$(container_ip "${i}")")
done

echo "[partition] drop A(0..$((HALF - 1))) ↔ B(${HALF}..$((COMPOSE_NODES - 1)))"
for a in $(seq 0 $((HALF - 1))); do
  for b in $(seq "${HALF}" $((COMPOSE_NODES - 1))); do
    drop_pair "${a}" "${IPS[${b}]}"
    drop_pair "${b}" "${IPS[${a}]}"
  done
done

echo "[partition] partition active"
