#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! "$ROOT_DIR/scripts/ops/detect-node-bin.sh" --check-current >/dev/null 2>&1; then
  export PATH="$("$ROOT_DIR/scripts/ops/detect-node-bin.sh" --print-runtime-path)"
fi

: "${CODEXNEXT_RELAY_URL:?CODEXNEXT_RELAY_URL is required}"
: "${CODEXNEXT_OWNER_TOKEN:?CODEXNEXT_OWNER_TOKEN is required}"
: "${CODEXNEXT_PUBLIC_ORIGIN:?CODEXNEXT_PUBLIC_ORIGIN is required}"
: "${CODEXNEXT_WEB_AUTH_PASSWORD_HASH:?CODEXNEXT_WEB_AUTH_PASSWORD_HASH is required}"
: "${CODEXNEXT_WEB_SESSION_SECRET:?CODEXNEXT_WEB_SESSION_SECRET is required}"

export NEXT_PUBLIC_CODEXNEXT_RELAY_URL="$CODEXNEXT_RELAY_URL"
export CODEXNEXT_RELAY_URL
export CODEXNEXT_OWNER_TOKEN
export CODEXNEXT_PUBLIC_ORIGIN
export CODEXNEXT_WEB_AUTH_PASSWORD_HASH
export CODEXNEXT_WEB_SESSION_SECRET

if [[ -n "${CODEXNEXT_DISABLE_RELAY_FULL_ACCESS:-}" ]]; then
  export NEXT_PUBLIC_CODEXNEXT_DISABLE_RELAY_FULL_ACCESS="$CODEXNEXT_DISABLE_RELAY_FULL_ACCESS"
  export CODEXNEXT_DISABLE_RELAY_FULL_ACCESS
fi

if [[ -n "${CODEXNEXT_ALLOW_URL_TOKEN:-}" ]]; then
  export NEXT_PUBLIC_CODEXNEXT_ALLOW_URL_TOKEN="$CODEXNEXT_ALLOW_URL_TOKEN"
fi

if [[ "${NODE_ENV:-}" != "production" && "${CODEXNEXT_PRODUCTION:-0}" != "1" && "${CODEXNEXT_TRACE:-0}" == "1" ]]; then
  export NEXT_PUBLIC_CODEXNEXT_TRACE="1"
fi

HOST="${CODEXNEXT_WEB_HOST:-0.0.0.0}"
PORT="${CODEXNEXT_WEB_PORT:-3002}"

cd "$ROOT_DIR"
if [[ "${CODEXNEXT_WEB_MODE:-start}" == "dev" ]]; then
  exec pnpm --filter @codexnext/web exec next dev -H "$HOST" -p "$PORT"
fi

exec pnpm --filter @codexnext/web exec next start -H "$HOST" -p "$PORT"
