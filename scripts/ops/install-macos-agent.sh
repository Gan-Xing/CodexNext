#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${HOME}/.codexnext/relay-agent.env"
PLIST_LABEL="com.codexnext.relay-agent"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOAD_AFTER_INSTALL=1

usage() {
  cat <<'EOF'
Install the CodexNext relay agent as a macOS launchd service.

Usage:
  ./scripts/ops/install-macos-agent.sh [options]

Options:
  --root /path/to/repo               Repo root to bake into the plist
  --env-file ~/.codexnext/file.env   Env file to source before starting the agent
  --plist-label com.example.agent    launchd label override
  --no-load                          Install only, do not load now
  -h, --help                         Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT_DIR="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --plist-label)
      PLIST_LABEL="${2:-}"
      PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
      shift 2
      ;;
    --no-load)
      LOAD_AFTER_INSTALL=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

mkdir -p "${HOME}/.codexnext" "${HOME}/Library/LaunchAgents"

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 600 "$ROOT_DIR/ops/launchd/relay-agent.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE from example. Fill in the real relay URL and device name."
fi

rendered="$(mktemp)"
sed "s#__CODEXNEXT_ROOT__#$ROOT_DIR#g" \
  "$ROOT_DIR/ops/launchd/com.codexnext.relay-agent.plist.template" >"$rendered"
install -m 644 "$rendered" "$PLIST_PATH"
rm -f "$rendered"

if [[ "$LOAD_AFTER_INSTALL" == "1" ]]; then
  launchctl bootout "gui/$(id -u)/$PLIST_LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
fi

cat <<EOF
Installed launchd agent:
  Label: $PLIST_LABEL
  Plist: $PLIST_PATH
  Env:   $ENV_FILE

Check status with:
  launchctl print "gui/$(id -u)/$PLIST_LABEL"
EOF
