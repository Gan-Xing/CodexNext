#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_PREFIX="codexnext"
ENV_DIR="/etc/codexnext"
INSTALL_USER="${SUDO_USER:-$USER}"
ROLES=(control web agent)
START_AFTER_INSTALL=1

usage() {
  cat <<'EOF'
Install CodexNext systemd services.

Usage:
  ./scripts/ops/install-linux-services.sh [options]

Options:
  --roles control,web,agent   Comma-separated roles to install. Default: control,web,agent
  --root /path/to/repo        Repo root to bake into service units
  --user ubuntu               Linux user that should run the services
  --env-dir /etc/codexnext    Directory for env files
  --no-start                  Install/enable only, do not start services now
  -h, --help                  Show this help

Examples:
  ./scripts/ops/install-linux-services.sh
  ./scripts/ops/install-linux-services.sh --roles agent
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --roles)
      IFS=',' read -r -a ROLES <<<"${2:-}"
      shift 2
      ;;
    --root)
      ROOT_DIR="${2:-}"
      shift 2
      ;;
    --user)
      INSTALL_USER="${2:-}"
      shift 2
      ;;
    --env-dir)
      ENV_DIR="${2:-}"
      shift 2
      ;;
    --no-start)
      START_AFTER_INSTALL=0
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

sudo_cmd=""
if [[ "${EUID}" -ne 0 ]]; then
  sudo_cmd="sudo"
fi

normalize_role() {
  case "$1" in
    control|web|agent)
      printf '%s\n' "$1"
      ;;
    *)
      echo "Unsupported role: $1" >&2
      exit 1
      ;;
  esac
}

install_env_file() {
  local role="$1"
  local target="$ENV_DIR/$role.env"
  local example="$ROOT_DIR/ops/systemd/$role.env.example"
  if [[ ! -f "$target" ]]; then
    $sudo_cmd install -m 600 "$example" "$target"
    echo "Created $target from example. Fill in the real values before first use."
  fi
}

install_unit() {
  local role="$1"
  local target="/etc/systemd/system/${SERVICE_PREFIX}-${role}.service"
  local template="$ROOT_DIR/ops/systemd/${SERVICE_PREFIX}-${role}.service.example"
  local rendered
  rendered="$(mktemp)"
  sed \
    -e "s#__CODEXNEXT_ROOT__#$ROOT_DIR#g" \
    -e "s#__CODEXNEXT_USER__#$INSTALL_USER#g" \
    "$template" >"$rendered"
  $sudo_cmd install -m 644 "$rendered" "$target"
  rm -f "$rendered"
}

$sudo_cmd mkdir -p "$ENV_DIR"

selected_units=()
for role in "${ROLES[@]}"; do
  normalized_role="$(normalize_role "$role")"
  install_env_file "$normalized_role"
  install_unit "$normalized_role"
  selected_units+=("${SERVICE_PREFIX}-${normalized_role}.service")
done

$sudo_cmd systemctl daemon-reload
$sudo_cmd systemctl enable "${selected_units[@]}"

if [[ "$START_AFTER_INSTALL" == "1" ]]; then
  $sudo_cmd systemctl restart "${selected_units[@]}"
fi

cat <<EOF
Installed roles: ${ROLES[*]}
User: $INSTALL_USER
Repo root: $ROOT_DIR
Env dir: $ENV_DIR

Check status with:
  sudo systemctl status ${selected_units[*]}
EOF
