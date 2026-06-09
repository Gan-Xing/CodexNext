#!/usr/bin/env bash
set -euo pipefail

requested_name="${1:-codex}"

append_path_if_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    PATH="$dir:$PATH"
  fi
}

append_path_if_dir "$HOME/.local/bin"
append_path_if_dir "$HOME/bin"
append_path_if_dir "/usr/local/bin"

if [[ -d "$HOME/.nvm/versions/node" ]]; then
  while IFS= read -r dir; do
    append_path_if_dir "$dir"
  done < <(find "$HOME/.nvm/versions/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -r)
fi

if command -v "$requested_name" >/dev/null 2>&1; then
  command -v "$requested_name"
  exit 0
fi

candidate_paths=(
  "$HOME/.nvm/versions/node"/*/bin/"$requested_name"
  "$HOME/.local/bin/$requested_name"
  "$HOME/bin/$requested_name"
  "/usr/local/bin/$requested_name"
)

for candidate in "${candidate_paths[@]}"; do
  if [[ -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

printf 'Unable to locate "%s". Set CODEXNEXT_CODEX_BIN to the absolute codex binary path.\n' "$requested_name" >&2
exit 1
