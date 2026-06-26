SERVER_ENV ?= backend/.env
BACKEND_COMPOSE = docker compose -f docker-compose.backend.yml
SERVER_API = ( cd backend && exec bun run src/index.ts )
LIN_KE_WORKER = ( cd backend && exec bun run src/lin-ke/worker.ts )
FRONTEND_DEV = ( cd frontend && exec bun run dev )
DESKTOP_DEV = bun run electron:dev
LOAD_SERVER_ENV = set -a; [ ! -f "$(SERVER_ENV)" ] || . "$(SERVER_ENV)"; : "$${REDIS_URL:=redis://127.0.0.1:$${REDIS_PORT:-6379}}"; : "$${POSTGRES_DATA_DIR:=$(CURDIR)/.local/postgres-data}"; export REDIS_URL POSTGRES_DATA_DIR; set +a;

.PHONY: dev run-api run-worker run-frontend run-desktop run-infra migrate-local

dev:
	bun run dev

run-api:
	@$(LOAD_SERVER_ENV) $(SERVER_API)

run-worker:
	@$(LOAD_SERVER_ENV) $(LIN_KE_WORKER)

run-frontend:
	$(FRONTEND_DEV)

run-desktop:
	$(DESKTOP_DEV)

run-infra:
	@$(LOAD_SERVER_ENV) \
	ensure_container() { \
		name="$$1"; \
		service="$$2"; \
		if docker container inspect "$$name" >/dev/null 2>&1; then \
			docker start "$$name" >/dev/null || exit $$?; \
		else \
			$(BACKEND_COMPOSE) up -d "$$service" || exit $$?; \
		fi; \
	}; \
	ensure_container foodism-gravity-postgres postgres; \
	ensure_container foodism-gravity-redis redis

migrate-local:
	@$(LOAD_SERVER_ENV) bun run --filter='@proma/server' db:create-local && bun run server:db:migrate && bun run --filter='@proma/server' db:seed-local
