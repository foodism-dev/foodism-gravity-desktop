#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/docker-compose.dokploy.backend.yml}"
DOKPLOY_PROJECT_NAME="${DOKPLOY_PROJECT_NAME:-foodism-gravity-server}"
DOKPLOY_ENVIRONMENT_NAME="${DOKPLOY_ENVIRONMENT_NAME:-test}"
DOKPLOY_COMPOSE_NAME="${DOKPLOY_COMPOSE_NAME:-backend}"
DOKPLOY_APP_NAME="${DOKPLOY_APP_NAME:-foodism-gravity-backend}"
POSTGRES_DATA_DIR="${POSTGRES_DATA_DIR:-/home/jik1992/projects/foodism-worker/postgres-data}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-proma}"
PROMA_SERVER_JWT_SECRET="${PROMA_SERVER_JWT_SECRET:-change-me-dokploy}"
REBUILD_BASE_URL="${REBUILD_BASE_URL:-}"
REBUILD_APP_ID="${REBUILD_APP_ID:-}"
REBUILD_APP_SECRET="${REBUILD_APP_SECRET:-}"
DOKPLOY_DEPLOY="${DOKPLOY_DEPLOY:-0}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "缺少环境变量: ${name}" >&2
    exit 1
  fi
}

normalize_host() {
  printf '%s' "$1" | sed -E 's#^https?://##; s#/.*$##; s/[[:space:]]//g'
}

normalize_url_origin() {
  node -e '
    const raw = process.argv[1];
    try {
      const url = new URL(raw);
      process.stdout.write(url.origin);
    } catch {
      process.stdout.write(raw.replace(/\/+$/, ""));
    }
  ' "$1"
}

resolve_ghcr_owner() {
  if [ -n "${GHCR_OWNER:-}" ]; then
    printf '%s' "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]'
    return
  fi

  if [ -n "${GITHUB_REPOSITORY_OWNER:-}" ]; then
    printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]'
    return
  fi

  local remote_url
  remote_url="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
  if [ -n "$remote_url" ]; then
    printf '%s' "$remote_url" \
      | sed -E 's#^git@github.com:([^/]+)/.*$#\1#; s#^https://github.com/([^/]+)/.*$#\1#' \
      | tr '[:upper:]' '[:lower:]'
    return
  fi

  echo "无法推断 GHCR owner，请设置 GHCR_OWNER" >&2
  exit 1
}

json_get_first_id='
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : null;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.projects)
          ? payload.projects
          : Array.isArray(payload?.environments)
            ? payload.environments
            : Array.isArray(payload?.composes)
              ? payload.composes
              : payload
                ? [payload]
                : [];
  const item = rows.find((entry) => entry && (entry.projectId || entry.environmentId || entry.composeId || entry.id));
  process.stdout.write(item ? String(item.projectId || item.environmentId || item.composeId || item.id) : "");
'

json_get_compose_id='
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const projects = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || [payload]);
  const project = projects.find((entry) => entry.name === process.env.DOKPLOY_PROJECT_NAME);
  const environments = Array.isArray(project?.environments) ? project.environments : [];
  const environment = environments.find((entry) => entry.name === process.env.DOKPLOY_ENVIRONMENT_NAME);
  const rows = Array.isArray(environment?.compose) ? environment.compose : [];
  const item = rows.find((entry) => entry.name === process.env.DOKPLOY_COMPOSE_NAME || entry.appName === process.env.DOKPLOY_COMPOSE_NAME);
  process.stdout.write(item ? String(item.composeId || item.id) : "");
'

json_get_compose_id_any_environment='
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const projects = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || [payload]);
  const project = projects.find((entry) => entry.name === process.env.DOKPLOY_PROJECT_NAME);
  const environments = Array.isArray(project?.environments) ? project.environments : [];
  for (const environment of environments) {
    const rows = Array.isArray(environment?.compose) ? environment.compose : [];
    const item = rows.find((entry) => entry.name === process.env.DOKPLOY_COMPOSE_NAME || entry.appName === process.env.DOKPLOY_COMPOSE_NAME);
    if (item) {
      process.stdout.write(String(item.composeId || item.id));
      process.exit(0);
    }
  }
'

require_env API_HOST

if [ -n "${DOKPLOY_URL:-}" ]; then
  DOKPLOY_URL="$(normalize_url_origin "$DOKPLOY_URL")"
  export DOKPLOY_URL
fi
if [ -n "${DOKPLOY_API_KEY:-}" ]; then
  export DOKPLOY_API_KEY
fi

API_HOST="$(normalize_host "$API_HOST")"
if [ -z "$API_HOST" ]; then
  echo "API_HOST 规范化后为空" >&2
  exit 1
fi

GHCR_OWNER="$(resolve_ghcr_owner)"
IMAGE_TAG="${IMAGE_TAG:-latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/${GHCR_OWNER}/foodism-gravity-backend:${IMAGE_TAG}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-ghcr.io/${GHCR_OWNER}/foodism-gravity-postgres:17-alpine}"
DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}}"

env_file="$(mktemp)"
cleanup() {
  rm -f "$env_file"
}
trap cleanup EXIT

{
  printf 'API_HOST=%s\n' "$API_HOST"
  printf 'BACKEND_IMAGE=%s\n' "$BACKEND_IMAGE"
  printf 'POSTGRES_IMAGE=%s\n' "$POSTGRES_IMAGE"
  printf 'POSTGRES_USER=%s\n' "$POSTGRES_USER"
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'POSTGRES_DB=%s\n' "$POSTGRES_DB"
  printf 'POSTGRES_DATA_DIR=%s\n' "$POSTGRES_DATA_DIR"
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
  printf 'PROMA_SERVER_JWT_SECRET=%s\n' "$PROMA_SERVER_JWT_SECRET"
  printf 'REBUILD_BASE_URL=%s\n' "$REBUILD_BASE_URL"
  printf 'REBUILD_APP_ID=%s\n' "$REBUILD_APP_ID"
  printf 'REBUILD_APP_SECRET=%s\n' "$REBUILD_APP_SECRET"
} > "$env_file"

echo "[Dokploy] 校验 compose: ${COMPOSE_FILE}"
docker compose --env-file "$env_file" -f "$COMPOSE_FILE" config >/dev/null

echo "[Dokploy] 同步项目: ${DOKPLOY_PROJECT_NAME}"
project_json="$(npx -y @dokploy/cli project all --json)"
project_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" node -e '
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const rows = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || []);
  const item = rows.find((entry) => entry.name === process.env.DOKPLOY_PROJECT_NAME);
  process.stdout.write(item ? String(item.projectId || item.id) : "");
')"
if [ -z "$project_id" ]; then
  project_json="$(npx -y @dokploy/cli project create \
    --name "$DOKPLOY_PROJECT_NAME" \
    --description "Foodism Gravity server" \
    --json)"
  project_id="$(printf '%s' "$project_json" | node -e "$json_get_first_id")"
fi

echo "[Dokploy] 同步环境: ${DOKPLOY_ENVIRONMENT_NAME}"
environment_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" node -e '
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const projects = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || [payload]);
  const project = projects.find((entry) => entry.name === process.env.DOKPLOY_PROJECT_NAME);
  const rows = Array.isArray(project?.environments) ? project.environments : [];
  const item = rows.find((entry) => entry.name === process.env.DOKPLOY_ENVIRONMENT_NAME);
  process.stdout.write(item ? String(item.environmentId || item.id) : "");
')"
if [ -z "$environment_id" ]; then
  environment_json="$(npx -y @dokploy/cli environment create \
    --name "$DOKPLOY_ENVIRONMENT_NAME" \
    --description "Managed by scripts/sync-dokploy-compose.sh" \
    --projectId "$project_id" \
    --json)"
  environment_id="$(printf '%s' "$environment_json" | node -e "$json_get_first_id")"
  project_json="$(npx -y @dokploy/cli project all --json)"
fi

compose_content="$(cat "$COMPOSE_FILE")"
compose_env="$(cat "$env_file")"
echo "[Dokploy] 同步 Compose: ${DOKPLOY_COMPOSE_NAME}"
compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id")"
if [ -z "$compose_id" ]; then
  existing_compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id_any_environment")"
  if [ -n "$existing_compose_id" ]; then
    npx -y @dokploy/cli compose update \
      --composeId "$existing_compose_id" \
      --environmentId "$environment_id" \
      --json >/dev/null
    project_json="$(npx -y @dokploy/cli project all --json)"
    compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id")"
  elif [ -n "${DOKPLOY_SERVER_ID:-}" ]; then
    compose_json="$(npx -y @dokploy/cli compose create \
      --name "$DOKPLOY_COMPOSE_NAME" \
      --description "Foodism Gravity backend compose" \
      --environmentId "$environment_id" \
      --composeType docker-compose \
      --appName "$DOKPLOY_APP_NAME" \
      --serverId "$DOKPLOY_SERVER_ID" \
      --composeFile "$compose_content" \
      --json)"
  else
    compose_json="$(npx -y @dokploy/cli compose create \
      --name "$DOKPLOY_COMPOSE_NAME" \
      --description "Foodism Gravity backend compose" \
      --environmentId "$environment_id" \
      --composeType docker-compose \
      --appName "$DOKPLOY_APP_NAME" \
      --composeFile "$compose_content" \
      --json)"
  fi
  if [ -z "$compose_id" ]; then
    project_json="$(npx -y @dokploy/cli project all --json)"
    compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id")"
  fi
  if [ -z "$compose_id" ]; then
    echo "创建 Compose 后未能读取 composeId" >&2
    exit 1
  fi
fi

npx -y @dokploy/cli compose update \
  --composeId "$compose_id" \
  --name "$DOKPLOY_COMPOSE_NAME" \
  --appName "$DOKPLOY_APP_NAME" \
  --description "Foodism Gravity backend compose" \
  --sourceType raw \
  --composeType docker-compose \
  --composeFile "$compose_content" \
  --env "$compose_env"

echo "[Dokploy] 已同步"
echo "  Project: ${DOKPLOY_PROJECT_NAME} (${project_id})"
echo "  Environment: ${DOKPLOY_ENVIRONMENT_NAME} (${environment_id})"
echo "  Compose: ${DOKPLOY_COMPOSE_NAME} (${compose_id})"
echo "  API: https://${API_HOST}"
echo "  Backend image: ${BACKEND_IMAGE}"
echo "  Postgres image: ${POSTGRES_IMAGE}"

if [ "$DOKPLOY_DEPLOY" = "1" ]; then
  echo "[Dokploy] 触发部署"
  npx -y @dokploy/cli compose deploy \
    --composeId "$compose_id" \
    --title "Manual compose sync deploy" \
    --description "Deploy ${BACKEND_IMAGE}"
fi
