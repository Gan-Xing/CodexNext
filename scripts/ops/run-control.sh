#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${CODEXNEXT_OWNER_TOKEN:?CODEXNEXT_OWNER_TOKEN is required}"

HOST="${CODEXNEXT_CONTROL_HOST:-0.0.0.0}"
PORT="${CODEXNEXT_CONTROL_PORT:-3922}"
HEARTBEAT_INTERVAL_MS="${CODEXNEXT_HEARTBEAT_INTERVAL_MS:-15000}"
STALE_DEVICE_TIMEOUT_MS="${CODEXNEXT_STALE_DEVICE_TIMEOUT_MS:-}"
RPC_TIMEOUT_MS="${CODEXNEXT_RPC_TIMEOUT_MS:-30000}"
PRODUCTION="${CODEXNEXT_PRODUCTION:-1}"
ALLOW_MACHINE_OWNER_TOKEN="${CODEXNEXT_ALLOW_MACHINE_OWNER_TOKEN:-0}"
DISABLE_RELAY_FULL_ACCESS="${CODEXNEXT_DISABLE_RELAY_FULL_ACCESS:-0}"
PUBLIC_WEB_ORIGIN="${CODEXNEXT_PUBLIC_WEB_ORIGIN:-}"

cd "$ROOT_DIR"

args=(
  --host "$HOST"
  --port "$PORT"
  --owner-token "$CODEXNEXT_OWNER_TOKEN"
  --heartbeat-interval-ms "$HEARTBEAT_INTERVAL_MS"
  --rpc-timeout-ms "$RPC_TIMEOUT_MS"
)

if [[ -n "$STALE_DEVICE_TIMEOUT_MS" ]]; then
  args+=(--stale-device-timeout-ms "$STALE_DEVICE_TIMEOUT_MS")
fi

if [[ "$PRODUCTION" == "1" ]]; then
  args+=(--production)
fi

if [[ "$ALLOW_MACHINE_OWNER_TOKEN" == "1" ]]; then
  args+=(--allow-machine-owner-token)
fi

if [[ "$DISABLE_RELAY_FULL_ACCESS" == "1" ]]; then
  args+=(--disable-relay-full-access)
fi

if [[ -n "$PUBLIC_WEB_ORIGIN" ]]; then
  args+=(--public-web-origin "$PUBLIC_WEB_ORIGIN")
fi

if [[ -n "${CODEXNEXT_ALLOWED_ORIGINS:-}" ]]; then
  IFS=',' read -r -a origins <<<"${CODEXNEXT_ALLOWED_ORIGINS}"
  for origin in "${origins[@]}"; do
    trimmed="$(printf '%s' "$origin" | xargs)"
    if [[ -n "$trimmed" ]]; then
      args+=(--allow-origin "$trimmed")
    fi
  done
fi

exec pnpm --filter @codexnext/control dev -- "${args[@]}"
