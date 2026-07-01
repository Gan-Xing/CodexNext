#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${CODEXNEXT_WEB_ENV_FILE:-/etc/codexnext/web.env}"
SERVICE_NAME="${CODEXNEXT_WEB_SERVICE_NAME:-codexnext-web.service}"

load_environment_file() {
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export[[:space:]]* ]] && line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ || "$line" != *=* ]]; then
      echo "Ignoring unsupported environment line in $ENV_FILE: $line" >&2
      continue
    fi
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done < "$ENV_FILE"
}

if [[ -f "$ENV_FILE" ]]; then
  load_environment_file
fi

service_user="${CODEXNEXT_WEB_SERVICE_USER:-}"
if [[ -z "$service_user" ]] && command -v systemctl >/dev/null 2>&1; then
  service_user="$(systemctl show -p User --value "$SERVICE_NAME" 2>/dev/null || true)"
fi
service_user="${service_user:-$(id -un)}"

if [[ "$service_user" == "$(id -un)" ]]; then
  if ! "$ROOT_DIR/scripts/ops/detect-node-bin.sh" --check-current >/dev/null 2>&1; then
    export PATH="$("$ROOT_DIR/scripts/ops/detect-node-bin.sh" --print-runtime-path)"
  fi
else
  export PATH="$("$ROOT_DIR/scripts/ops/detect-node-bin.sh" --user "$service_user" --print-runtime-path)"
fi

build_as_current_user() {
  "$ROOT_DIR/scripts/ops/build-web.sh"
}

build_as_service_user() {
  local preserve_env
  preserve_env="$(
    IFS=,
    echo "PATH,CODEXNEXT_RELAY_URL,CODEXNEXT_CONTROL_URL,CODEXNEXT_OWNER_TOKEN,CODEXNEXT_PUBLIC_ORIGIN,CODEXNEXT_WEB_AUTH_PASSWORD_HASH,CODEXNEXT_WEB_SESSION_SECRET,CODEXNEXT_DISABLE_RELAY_FULL_ACCESS,CODEXNEXT_ALLOW_URL_TOKEN,CODEXNEXT_PRODUCTION,CODEXNEXT_TRACE"
  )"
  sudo --preserve-env="$preserve_env" -u "$service_user" \
    "$ROOT_DIR/scripts/ops/build-web.sh"
}

if [[ "$(id -un)" == "$service_user" ]]; then
  build_as_current_user
elif command -v sudo >/dev/null 2>&1; then
  build_as_service_user
else
  echo "Cannot switch to service user '$service_user': sudo is unavailable." >&2
  exit 1
fi

if [[ "$service_user" != "root" ]]; then
  sudo -u "$service_user" test -r "$ROOT_DIR/apps/web/.next/BUILD_ID"
  sudo -u "$service_user" test -x "$ROOT_DIR/apps/web/.next/server"
fi

if [[ "${CODEXNEXT_DEPLOY_WEB_RESTART:-1}" != "0" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart "$SERVICE_NAME"
  else
    echo "systemctl is unavailable; Web build is ready but service was not restarted." >&2
  fi
fi
