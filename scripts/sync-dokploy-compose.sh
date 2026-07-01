#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/docker-compose.dokploy.backend.yml}"
DOKPLOY_PROJECT_NAME="${DOKPLOY_PROJECT_NAME:-foodism-gravity-server}"
DOKPLOY_ENVIRONMENT_NAME="${DOKPLOY_ENVIRONMENT_NAME:-test}"
DOKPLOY_PROJECT_ID="${DOKPLOY_PROJECT_ID:-RBW57ZuC09XdoqA7iMBuc}"
DOKPLOY_ENVIRONMENT_ID="${DOKPLOY_ENVIRONMENT_ID:-abJQcCIMSWS73H2DWaV4e}"
DOKPLOY_COMPOSE_NAME="${DOKPLOY_COMPOSE_NAME:-backend}"
DOKPLOY_APP_NAME="${DOKPLOY_APP_NAME:-foodism-gravity-backend}"
DOKPLOY_POSTGRES_ID="${DOKPLOY_POSTGRES_ID:-bWPrCEgrILyitIyL70JgB}"
DOKPLOY_REDIS_ID="${DOKPLOY_REDIS_ID:-_V_Om-E3YaAxuiszlHwXE}"
PROMA_SERVER_JWT_SECRET="${PROMA_SERVER_JWT_SECRET:-}"
GRAVITY_SSO_ISSUER="${GRAVITY_SSO_ISSUER:-}"
GRAVITY_WEB_REDIRECT_URI="${GRAVITY_WEB_REDIRECT_URI:-}"
GRAVITY_WEB_SSO_LOGIN_URL="${GRAVITY_WEB_SSO_LOGIN_URL:-}"
GRAVITY_WEB_CLIENT_ID="${GRAVITY_WEB_CLIENT_ID:-}"
GRAVITY_WEB_SCOPE="${GRAVITY_WEB_SCOPE:-}"
GRAVITY_WEB_DEFAULT_RETURN_TO="${GRAVITY_WEB_DEFAULT_RETURN_TO:-}"
REBUILD_BASE_URL="${REBUILD_BASE_URL:-}"
REBUILD_APP_ID="${REBUILD_APP_ID:-}"
REBUILD_APP_SECRET="${REBUILD_APP_SECRET:-}"
REBUILD_LOGIN_USER="${REBUILD_LOGIN_USER:-}"
REBUILD_LOGIN_PASSWORD="${REBUILD_LOGIN_PASSWORD:-}"
REBUILD_LOGIN_COOKIE_TTL_SECONDS="${REBUILD_LOGIN_COOKIE_TTL_SECONDS:-1800}"
REBUILD_ASSET_R2_PREFIX="${REBUILD_ASSET_R2_PREFIX:-rebuild-assets}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-}"
OPTIMIZE_MODEL="${OPTIMIZE_MODEL:-gpt-4o-mini}"
OPTIMIZE_CONCURRENCY="${OPTIMIZE_CONCURRENCY:-5}"
OPTIMIZE_MAX_BATCH_SIZE="${OPTIMIZE_MAX_BATCH_SIZE:-20}"
OPTIMIZE_RETRIES="${OPTIMIZE_RETRIES:-3}"
LIN_KE_BASE_URL="${LIN_KE_BASE_URL:-https://www.life-partner.cn}"
LIN_KE_TIMEOUT="${LIN_KE_TIMEOUT:-60}"
LIN_KE_DRAFT_WORKER_CONCURRENCY="${LIN_KE_DRAFT_WORKER_CONCURRENCY:-1}"
LIN_KE_TEST_SKIP_ENABLED="${LIN_KE_TEST_SKIP_ENABLED:-false}"
RB_IMAGE_BASE_URL="${RB_IMAGE_BASE_URL:-}"
IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS="${IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS:-300000}"
IMPORT_FROM_SUPPLYGOODS_PAGES="${IMPORT_FROM_SUPPLYGOODS_PAGES:-1}"
GRAVITY_JOBS_WORKER_CONCURRENCY="${GRAVITY_JOBS_WORKER_CONCURRENCY:-1}"
CLOUDFLARE_R2_ENDPOINT_URL="${CLOUDFLARE_R2_ENDPOINT_URL:-}"
CLOUDFLARE_R2_ACCESS_KEY_ID="${CLOUDFLARE_R2_ACCESS_KEY_ID:-}"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="${CLOUDFLARE_R2_SECRET_ACCESS_KEY:-}"
CLOUDFLARE_R2_BUCKET="${CLOUDFLARE_R2_BUCKET:-}"
CLOUDFLARE_R2_PUBLIC_BASE_URL="${CLOUDFLARE_R2_PUBLIC_BASE_URL:-}"
CLOUDFLARE_R2_PREFIX="${CLOUDFLARE_R2_PREFIX:-upload_file}"
CLOUDFLARE_R2_REGION="${CLOUDFLARE_R2_REGION:-auto}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
DOKPLOY_DEPLOY="${DOKPLOY_DEPLOY:-0}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "缺少环境变量: ${name}" >&2
    exit 1
  fi
}

reject_placeholder_secret() {
  local name="$1"
  local value="${!name:-}"
  case "$value" in
    change-me*|replace-with*)
      echo "环境变量 ${name} 仍是占位值，请先设置真实密钥" >&2
      exit 1
      ;;
  esac
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

api_get() {
  local endpoint="$1"
  require_env DOKPLOY_URL
  require_env DOKPLOY_API_KEY
  curl -fsS -H "x-api-key: ${DOKPLOY_API_KEY}" "${DOKPLOY_URL%/}/api/${endpoint}"
}

resolve_dokploy_postgres_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    printf '%s' "$DATABASE_URL"
    return
  fi

  require_env DOKPLOY_POSTGRES_ID
  api_get "postgres.one?postgresId=${DOKPLOY_POSTGRES_ID}" | node -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const item = payload.data || payload;
    const required = ["appName", "databaseUser", "databasePassword", "databaseName"];
    for (const key of required) {
      if (!item[key]) {
        console.error(`Dokploy Postgres 缺少 ${key}`);
        process.exit(1);
      }
    }
    const user = encodeURIComponent(item.databaseUser);
    const password = encodeURIComponent(item.databasePassword);
    const database = encodeURIComponent(item.databaseName);
    process.stdout.write(`postgres://${user}:${password}@${item.appName}:5432/${database}`);
  '
}

resolve_dokploy_redis_url() {
  if [ -n "${REDIS_URL:-}" ]; then
    printf '%s' "$REDIS_URL"
    return
  fi

  require_env DOKPLOY_REDIS_ID
  api_get "redis.one?redisId=${DOKPLOY_REDIS_ID}" | node -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const item = payload.data || payload;
    if (!item.appName) {
      console.error("Dokploy Redis 缺少 appName");
      process.exit(1);
    }
    const password = item.databasePassword ? `:${encodeURIComponent(item.databasePassword)}@` : "";
    process.stdout.write(`redis://${password}${item.appName}:6379`);
  '
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
  const projectId = process.env.DOKPLOY_PROJECT_ID;
  const environmentId = process.env.DOKPLOY_ENVIRONMENT_ID;
  const project = projects.find((entry) =>
    (projectId && String(entry.projectId || entry.id) === projectId)
    || entry.name === process.env.DOKPLOY_PROJECT_NAME
  );
  const environments = Array.isArray(project?.environments) ? project.environments : [];
  const environment = environments.find((entry) =>
    (environmentId && String(entry.environmentId || entry.id) === environmentId)
    || entry.name === process.env.DOKPLOY_ENVIRONMENT_NAME
  );
  const rows = Array.isArray(environment?.compose) ? environment.compose : [];
  const item = rows.find((entry) => entry.name === process.env.DOKPLOY_COMPOSE_NAME || entry.appName === process.env.DOKPLOY_COMPOSE_NAME);
  process.stdout.write(item ? String(item.composeId || item.id) : "");
'

json_get_compose_id_any_environment='
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const projects = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || [payload]);
  const projectId = process.env.DOKPLOY_PROJECT_ID;
  const project = projects.find((entry) =>
    (projectId && String(entry.projectId || entry.id) === projectId)
    || entry.name === process.env.DOKPLOY_PROJECT_NAME
  );
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
require_env FRONTEND_HOST
require_env PROMA_SERVER_JWT_SECRET
reject_placeholder_secret PROMA_SERVER_JWT_SECRET

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
FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/${GHCR_OWNER}/foodism-gravity-frontend:${IMAGE_TAG}}"
DATABASE_URL="$(resolve_dokploy_postgres_url)"
REDIS_URL="$(resolve_dokploy_redis_url)"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://${API_HOST}}"
VITE_SSO_LOGIN_URL="${VITE_SSO_LOGIN_URL:-}"
VITE_LIN_KE_TEST_SKIP_ENABLED="${VITE_LIN_KE_TEST_SKIP_ENABLED:-${LIN_KE_TEST_SKIP_ENABLED}}"

env_file="$(mktemp)"
cleanup() {
  rm -f "$env_file"
}
trap cleanup EXIT

{
  printf 'API_HOST=%s\n' "$API_HOST"
  printf 'FRONTEND_HOST=%s\n' "$FRONTEND_HOST"
  printf 'BACKEND_IMAGE=%s\n' "$BACKEND_IMAGE"
  printf 'FRONTEND_IMAGE=%s\n' "$FRONTEND_IMAGE"
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
  printf 'REDIS_URL=%s\n' "$REDIS_URL"
  printf 'PROMA_SERVER_JWT_SECRET=%s\n' "$PROMA_SERVER_JWT_SECRET"
  printf 'GRAVITY_SSO_ISSUER=%s\n' "$GRAVITY_SSO_ISSUER"
  printf 'GRAVITY_WEB_REDIRECT_URI=%s\n' "$GRAVITY_WEB_REDIRECT_URI"
  printf 'GRAVITY_WEB_SSO_LOGIN_URL=%s\n' "$GRAVITY_WEB_SSO_LOGIN_URL"
  printf 'GRAVITY_WEB_CLIENT_ID=%s\n' "$GRAVITY_WEB_CLIENT_ID"
  printf 'GRAVITY_WEB_SCOPE=%s\n' "$GRAVITY_WEB_SCOPE"
  printf 'GRAVITY_WEB_DEFAULT_RETURN_TO=%s\n' "$GRAVITY_WEB_DEFAULT_RETURN_TO"
  printf 'REBUILD_BASE_URL=%s\n' "$REBUILD_BASE_URL"
  printf 'REBUILD_APP_ID=%s\n' "$REBUILD_APP_ID"
  printf 'REBUILD_APP_SECRET=%s\n' "$REBUILD_APP_SECRET"
  printf 'REBUILD_LOGIN_USER=%s\n' "$REBUILD_LOGIN_USER"
  printf 'REBUILD_LOGIN_PASSWORD=%s\n' "$REBUILD_LOGIN_PASSWORD"
  printf 'REBUILD_LOGIN_COOKIE_TTL_SECONDS=%s\n' "$REBUILD_LOGIN_COOKIE_TTL_SECONDS"
  printf 'REBUILD_ASSET_R2_PREFIX=%s\n' "$REBUILD_ASSET_R2_PREFIX"
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
  printf 'OPENAI_BASE_URL=%s\n' "$OPENAI_BASE_URL"
  printf 'OPTIMIZE_MODEL=%s\n' "$OPTIMIZE_MODEL"
  printf 'OPTIMIZE_CONCURRENCY=%s\n' "$OPTIMIZE_CONCURRENCY"
  printf 'OPTIMIZE_MAX_BATCH_SIZE=%s\n' "$OPTIMIZE_MAX_BATCH_SIZE"
  printf 'OPTIMIZE_RETRIES=%s\n' "$OPTIMIZE_RETRIES"
  printf 'LIN_KE_BASE_URL=%s\n' "$LIN_KE_BASE_URL"
  printf 'LIN_KE_TIMEOUT=%s\n' "$LIN_KE_TIMEOUT"
  printf 'LIN_KE_DRAFT_WORKER_CONCURRENCY=%s\n' "$LIN_KE_DRAFT_WORKER_CONCURRENCY"
  printf 'LIN_KE_TEST_SKIP_ENABLED=%s\n' "$LIN_KE_TEST_SKIP_ENABLED"
  printf 'RB_IMAGE_BASE_URL=%s\n' "$RB_IMAGE_BASE_URL"
  printf 'IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS=%s\n' "$IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS"
  printf 'IMPORT_FROM_SUPPLYGOODS_PAGES=%s\n' "$IMPORT_FROM_SUPPLYGOODS_PAGES"
  printf 'GRAVITY_JOBS_WORKER_CONCURRENCY=%s\n' "$GRAVITY_JOBS_WORKER_CONCURRENCY"
  printf 'CLOUDFLARE_R2_ENDPOINT_URL=%s\n' "$CLOUDFLARE_R2_ENDPOINT_URL"
  printf 'CLOUDFLARE_R2_ACCESS_KEY_ID=%s\n' "$CLOUDFLARE_R2_ACCESS_KEY_ID"
  printf 'CLOUDFLARE_R2_SECRET_ACCESS_KEY=%s\n' "$CLOUDFLARE_R2_SECRET_ACCESS_KEY"
  printf 'CLOUDFLARE_R2_BUCKET=%s\n' "$CLOUDFLARE_R2_BUCKET"
  printf 'CLOUDFLARE_R2_PUBLIC_BASE_URL=%s\n' "$CLOUDFLARE_R2_PUBLIC_BASE_URL"
  printf 'CLOUDFLARE_R2_PREFIX=%s\n' "$CLOUDFLARE_R2_PREFIX"
  printf 'CLOUDFLARE_R2_REGION=%s\n' "$CLOUDFLARE_R2_REGION"
  printf 'FRONTEND_PORT=%s\n' "$FRONTEND_PORT"
  printf 'VITE_API_BASE_URL=%s\n' "$VITE_API_BASE_URL"
  printf 'VITE_SSO_LOGIN_URL=%s\n' "$VITE_SSO_LOGIN_URL"
  printf 'VITE_LIN_KE_TEST_SKIP_ENABLED=%s\n' "$VITE_LIN_KE_TEST_SKIP_ENABLED"
} > "$env_file"

echo "[Dokploy] 校验 compose: ${COMPOSE_FILE}"
docker compose --env-file "$env_file" -f "$COMPOSE_FILE" config >/dev/null

echo "[Dokploy] 同步项目: ${DOKPLOY_PROJECT_NAME}"
project_json="$(npx -y @dokploy/cli project all --json)"
project_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_ID="$DOKPLOY_PROJECT_ID" DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" node -e '
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const rows = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || []);
  const projectId = process.env.DOKPLOY_PROJECT_ID;
  const item = rows.find((entry) =>
    (projectId && String(entry.projectId || entry.id) === projectId)
    || entry.name === process.env.DOKPLOY_PROJECT_NAME
  );
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
environment_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_ID="$DOKPLOY_PROJECT_ID" DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_ID="$DOKPLOY_ENVIRONMENT_ID" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" node -e '
  const fs = require("node:fs");
  const input = fs.readFileSync(0, "utf8").trim();
  const payload = input ? JSON.parse(input) : [];
  const projects = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || [payload]);
  const projectId = process.env.DOKPLOY_PROJECT_ID;
  const environmentId = process.env.DOKPLOY_ENVIRONMENT_ID;
  const project = projects.find((entry) =>
    (projectId && String(entry.projectId || entry.id) === projectId)
    || entry.name === process.env.DOKPLOY_PROJECT_NAME
  );
  const rows = Array.isArray(project?.environments) ? project.environments : [];
  const item = rows.find((entry) =>
    (environmentId && String(entry.environmentId || entry.id) === environmentId)
    || entry.name === process.env.DOKPLOY_ENVIRONMENT_NAME
  );
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
compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_ID="$DOKPLOY_PROJECT_ID" DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_ID="$DOKPLOY_ENVIRONMENT_ID" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id")"
if [ -z "$compose_id" ]; then
  existing_compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_ID="$DOKPLOY_PROJECT_ID" DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id_any_environment")"
  if [ -n "$existing_compose_id" ]; then
    npx -y @dokploy/cli compose update \
      --composeId "$existing_compose_id" \
      --environmentId "$environment_id" \
      --json >/dev/null
    project_json="$(npx -y @dokploy/cli project all --json)"
    compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_ID="$DOKPLOY_PROJECT_ID" DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_ID="$DOKPLOY_ENVIRONMENT_ID" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id")"
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
    compose_id="$(printf '%s' "$project_json" | DOKPLOY_PROJECT_ID="$DOKPLOY_PROJECT_ID" DOKPLOY_PROJECT_NAME="$DOKPLOY_PROJECT_NAME" DOKPLOY_ENVIRONMENT_ID="$DOKPLOY_ENVIRONMENT_ID" DOKPLOY_ENVIRONMENT_NAME="$DOKPLOY_ENVIRONMENT_NAME" DOKPLOY_COMPOSE_NAME="$DOKPLOY_COMPOSE_NAME" node -e "$json_get_compose_id")"
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
  --env "$compose_env" >/dev/null

echo "[Dokploy] 已同步"
echo "  Project: ${DOKPLOY_PROJECT_NAME} (${project_id})"
echo "  Environment: ${DOKPLOY_ENVIRONMENT_NAME} (${environment_id})"
echo "  Compose: ${DOKPLOY_COMPOSE_NAME} (${compose_id})"
echo "  API: https://${API_HOST}"
echo "  Frontend: https://${FRONTEND_HOST}"
echo "  Backend image: ${BACKEND_IMAGE}"
echo "  Frontend image: ${FRONTEND_IMAGE}"

if [ "$DOKPLOY_DEPLOY" = "1" ]; then
  echo "[Dokploy] 触发部署"
  npx -y @dokploy/cli compose deploy \
    --composeId "$compose_id" \
    --title "Manual compose sync deploy" \
    --description "Deploy ${BACKEND_IMAGE}"
fi
