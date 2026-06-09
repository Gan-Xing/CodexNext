#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${CODEXNEXT_RELAY_URL:?CODEXNEXT_RELAY_URL is required}"

DEVICE_NAME="${CODEXNEXT_DEVICE_NAME:-}"
CODEX_BIN="${CODEXNEXT_CODEX_BIN:-codex}"
APPROVAL_TIMEOUT_MS="${CODEXNEXT_APPROVAL_TIMEOUT_MS:-300000}"

cd "$ROOT_DIR"

args=(
  --relay "$CODEXNEXT_RELAY_URL"
  --approval-timeout-ms "$APPROVAL_TIMEOUT_MS"
  --codex-bin "$CODEX_BIN"
)

if [[ -n "$DEVICE_NAME" ]]; then
  args+=(--device-name "$DEVICE_NAME")
fi

exec pnpm --filter @codexnext/agent dev -- connect "${args[@]}"
