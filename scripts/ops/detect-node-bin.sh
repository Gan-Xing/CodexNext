#!/usr/bin/env bash
set -euo pipefail

TARGET_USER=""
REQUIRE_NODE_SQLITE=0
CHECK_CURRENT=0
OUTPUT_MODE="node-bin"
MIN_NODE_MAJOR=24

usage() {
  cat <<'EOF'
Detect a compatible Node runtime for CodexNext startup scripts and services.

Usage:
  ./scripts/ops/detect-node-bin.sh [options]

Options:
  --user ubuntu            Resolve candidates for this user instead of the current user
  --require-node-sqlite    Require support for the built-in node:sqlite module
  --print-runtime-path     Print the PATH value that should be used by the service
  --check-current          Exit 0 when the current PATH already has a compatible runtime
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      TARGET_USER="${2:-}"
      shift 2
      ;;
    --require-node-sqlite)
      REQUIRE_NODE_SQLITE=1
      shift
      ;;
    --print-runtime-path)
      OUTPUT_MODE="runtime-path"
      shift
      ;;
    --check-current)
      CHECK_CURRENT=1
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

CURRENT_USER="$(id -un)"
DISPLAY_USER="${TARGET_USER:-$CURRENT_USER}"

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

resolve_user_home() {
  local lookup_user="$TARGET_USER"
  if [[ -z "$lookup_user" ]]; then
    lookup_user="$CURRENT_USER"
  fi

  if [[ "$lookup_user" == "$CURRENT_USER" && -n "${HOME:-}" && -d "$HOME" ]]; then
    printf '%s\n' "$HOME"
    return 0
  fi

  local home_dir=""
  if command -v getent >/dev/null 2>&1; then
    home_dir="$(getent passwd "$lookup_user" | cut -d: -f6)"
  elif command -v dscl >/dev/null 2>&1; then
    home_dir="$(dscl . -read "/Users/$lookup_user" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
  fi

  if [[ -z "$home_dir" && "$lookup_user" =~ ^[A-Za-z0-9._-]+$ ]]; then
    home_dir="$(bash -lc "printf '%s\n' ~${lookup_user}" 2>/dev/null || true)"
  fi

  if [[ -n "$home_dir" && -d "$home_dir" ]]; then
    printf '%s\n' "$home_dir"
    return 0
  fi

  printf 'Unable to determine home directory for user "%s".\n' "$lookup_user" >&2
  exit 1
}

USER_HOME="$(resolve_user_home)"

node_version_is_supported() {
  local version="${1#v}"
  local major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  (( major >= MIN_NODE_MAJOR ))
}

current_runtime_is_compatible() {
  local current_node_bin
  local node_version
  current_node_bin="$(command -v node 2>/dev/null || true)"
  if [[ -z "$current_node_bin" ]]; then
    return 1
  fi

  command -v pnpm >/dev/null 2>&1 || return 1
  pnpm --version >/dev/null 2>&1 || return 1
  "$current_node_bin" -v >/dev/null 2>&1 || return 1
  node_version="$("$current_node_bin" -p 'process.versions.node' 2>/dev/null || true)"
  node_version_is_supported "$node_version" || return 1

  if [[ "$REQUIRE_NODE_SQLITE" == "1" ]]; then
    "$current_node_bin" --input-type=module -e 'await import("node:sqlite")' >/dev/null 2>&1 || return 1
  fi

  return 0
}

if [[ "$CHECK_CURRENT" == "1" ]]; then
  current_runtime_is_compatible
  exit $?
fi

build_runtime_path() {
  local node_bin_dir="$1"
  local -a dirs=()
  local dir

  for dir in \
    "$node_bin_dir" \
    "$USER_HOME/.local/share/pnpm" \
    "$USER_HOME/.local/bin" \
    "$USER_HOME/bin" \
    "/opt/homebrew/bin" \
    "/usr/local/bin" \
    "/usr/local/sbin" \
    "/usr/bin" \
    "/usr/sbin" \
    "/bin" \
    "/sbin"
  do
    if [[ -d "$dir" ]] && ! array_contains "$dir" "${dirs[@]}"; then
      dirs+=("$dir")
    fi
  done

  local joined=""
  for dir in "${dirs[@]}"; do
    joined="${joined:+$joined:}$dir"
  done

  printf '%s\n' "$joined"
}

validate_node_candidate() {
  local node_bin="$1"
  local runtime_path
  local node_version
  runtime_path="$(build_runtime_path "$(dirname "$node_bin")")"
  [[ -n "$runtime_path" ]] || return 1

  PATH="$runtime_path" command -v pnpm >/dev/null 2>&1 || return 1
  PATH="$runtime_path" pnpm --version >/dev/null 2>&1 || return 1
  "$node_bin" -v >/dev/null 2>&1 || return 1
  node_version="$("$node_bin" -p 'process.versions.node' 2>/dev/null || true)"
  node_version_is_supported "$node_version" || return 1

  if [[ "$REQUIRE_NODE_SQLITE" == "1" ]]; then
    "$node_bin" --input-type=module -e 'await import("node:sqlite")' >/dev/null 2>&1 || return 1
  fi

  printf '%s\n' "$runtime_path"
}

semver_gt() {
  local left="${1#v}"
  local right="${2#v}"
  local i
  local -a left_parts=()
  local -a right_parts=()
  local left_len=0
  local right_len=0
  local max_len=0
  local left_value=0
  local right_value=0

  IFS='.' read -r -a left_parts <<<"$left"
  IFS='.' read -r -a right_parts <<<"$right"
  left_len="${#left_parts[@]}"
  right_len="${#right_parts[@]}"
  max_len="$left_len"
  if (( right_len > max_len )); then
    max_len="$right_len"
  fi

  for (( i=0; i<max_len; i++ )); do
    left_value="${left_parts[i]:-0}"
    right_value="${right_parts[i]:-0}"
    if (( 10#$left_value > 10#$right_value )); then
      return 0
    fi
    if (( 10#$left_value < 10#$right_value )); then
      return 1
    fi
  done

  return 1
}

candidate_node_bins=()
append_candidate_node() {
  local candidate="$1"
  if [[ -x "$candidate" ]] && ! array_contains "$candidate" "${candidate_node_bins[@]}"; then
    candidate_node_bins+=("$candidate")
  fi
}

if [[ -z "$TARGET_USER" || "$TARGET_USER" == "$CURRENT_USER" ]]; then
  current_node_bin="$(command -v node 2>/dev/null || true)"
  if [[ -n "$current_node_bin" ]]; then
    append_candidate_node "$current_node_bin"
  fi
fi

if [[ -d "$USER_HOME/.nvm/versions/node" ]]; then
  while IFS= read -r candidate; do
    append_candidate_node "$candidate"
  done < <(find "$USER_HOME/.nvm/versions/node" -maxdepth 3 -type f -path '*/bin/node' 2>/dev/null)
fi

append_candidate_node "$USER_HOME/.local/bin/node"
append_candidate_node "$USER_HOME/bin/node"
append_candidate_node "/opt/homebrew/bin/node"
append_candidate_node "/usr/local/bin/node"
append_candidate_node "/usr/bin/node"

best_node_bin=""
best_runtime_path=""
best_version=""

for node_bin in "${candidate_node_bins[@]}"; do
  runtime_path="$(validate_node_candidate "$node_bin" 2>/dev/null || true)"
  if [[ -z "$runtime_path" ]]; then
    continue
  fi

  node_version="$("$node_bin" -p 'process.versions.node' 2>/dev/null || true)"
  if [[ -z "$node_version" ]]; then
    continue
  fi

  if [[ -z "$best_node_bin" ]]; then
    best_node_bin="$node_bin"
    best_runtime_path="$runtime_path"
    best_version="$node_version"
    continue
  fi

  if semver_gt "$node_version" "$best_version"; then
    best_node_bin="$node_bin"
    best_runtime_path="$runtime_path"
    best_version="$node_version"
  fi
done

if [[ -z "$best_node_bin" ]]; then
  capability_note=""
  if [[ "$REQUIRE_NODE_SQLITE" == "1" ]]; then
    capability_note=" and support for node:sqlite"
  fi
  cat >&2 <<EOF
Unable to locate a compatible Node runtime for CodexNext.

The selected runtime must provide:
- node >= $MIN_NODE_MAJOR
- pnpm
${capability_note:+- support for node:sqlite}

Searched common locations for user "$DISPLAY_USER":
- $USER_HOME/.nvm/versions/node/*/bin
- $USER_HOME/.local/share/pnpm
- $USER_HOME/.local/bin
- $USER_HOME/bin
- /opt/homebrew/bin
- /usr/local/bin
- /usr/bin
EOF
  exit 1
fi

if [[ "$OUTPUT_MODE" == "runtime-path" ]]; then
  printf '%s\n' "$best_runtime_path"
else
  printf '%s\n' "$best_node_bin"
fi
