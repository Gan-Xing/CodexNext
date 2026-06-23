#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! "$ROOT_DIR/scripts/ops/detect-node-bin.sh" --check-current --require-node-sqlite >/dev/null 2>&1; then
  export PATH="$("$ROOT_DIR/scripts/ops/detect-node-bin.sh" --print-runtime-path --require-node-sqlite)"
fi

: "${CODEXNEXT_RELAY_URL:?CODEXNEXT_RELAY_URL is required}"

DEVICE_NAME="${CODEXNEXT_DEVICE_NAME:-}"
CODEX_BIN="${CODEXNEXT_CODEX_BIN:-codex}"
APPROVAL_TIMEOUT_MS="${CODEXNEXT_APPROVAL_TIMEOUT_MS:-300000}"

if [[ "$CODEX_BIN" == */* ]]; then
  if [[ ! -x "$CODEX_BIN" ]]; then
    echo "Configured CODEXNEXT_CODEX_BIN is not executable: $CODEX_BIN" >&2
    exit 1
  fi
else
  if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
    CODEX_BIN="$("$ROOT_DIR/scripts/ops/detect-codex-bin.sh" "$CODEX_BIN")"
  fi
fi

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
