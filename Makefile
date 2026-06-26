SERVER_ENV ?= backend/.env
BACKEND_COMPOSE = docker compose -f docker-compose.backend.yml
SERVER_API = ( cd backend && exec bun run src/index.ts )
LIN_KE_WORKER = ( cd backend && exec bun run src/lin-ke/worker.ts )
FRONTEND_DEV = ( cd frontend && exec bun run dev )
LOAD_SERVER_ENV = set -a; [ ! -f "$(SERVER_ENV)" ] || . "$(SERVER_ENV)"; : "$${REDIS_URL:=redis://127.0.0.1:$${REDIS_PORT:-6379}}"; : "$${POSTGRES_DATA_DIR:=$(CURDIR)/.local/postgres-data}"; export REDIS_URL POSTGRES_DATA_DIR; set +a;

.PHONY: dev run-api run-api-only run-worker run-frontend run-infra dev-gravity migrate-local

dev:
	bun run dev

run-api: run-infra
	@$(LOAD_SERVER_ENV) \
	worker_pid=""; \
	cleanup() { \
		if [ -n "$$worker_pid" ] && kill -0 "$$worker_pid" 2>/dev/null; then \
			kill "$$worker_pid" 2>/dev/null || true; \
			wait "$$worker_pid" 2>/dev/null || true; \
		fi; \
	}; \
	trap 'status=$$?; cleanup; exit $$status' EXIT; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	$(LIN_KE_WORKER) & \
	worker_pid=$$!; \
	sleep 1; \
	if ! kill -0 "$$worker_pid" 2>/dev/null; then \
		wait "$$worker_pid"; \
		exit $$?; \
	fi; \
	$(SERVER_API)

run-api-only:
	@$(LOAD_SERVER_ENV) $(SERVER_API)

run-worker:
	@$(LOAD_SERVER_ENV) $(LIN_KE_WORKER)

run-frontend:
	$(FRONTEND_DEV)

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

dev-gravity: run-infra
	@$(LOAD_SERVER_ENV) \
	api_pid=""; \
	worker_pid=""; \
	frontend_pid=""; \
	cleanup() { \
		for pid in $$api_pid $$worker_pid $$frontend_pid; do \
			if [ -n "$$pid" ] && kill -0 "$$pid" 2>/dev/null; then \
				kill "$$pid" 2>/dev/null || true; \
				wait "$$pid" 2>/dev/null || true; \
			fi; \
		done; \
	}; \
	trap 'status=$$?; cleanup; exit $$status' EXIT; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	$(LIN_KE_WORKER) & \
	worker_pid=$$!; \
	sleep 1; \
	if ! kill -0 "$$worker_pid" 2>/dev/null; then \
		wait "$$worker_pid"; \
		exit $$?; \
	fi; \
	$(SERVER_API) & \
	api_pid=$$!; \
	$(FRONTEND_DEV) & \
	frontend_pid=$$!; \
	while :; do \
		for pid in $$api_pid $$worker_pid $$frontend_pid; do \
			if ! kill -0 "$$pid" 2>/dev/null; then \
				wait "$$pid"; \
				exit $$?; \
			fi; \
		done; \
		sleep 1; \
	done

migrate-local:
	@$(LOAD_SERVER_ENV) bun run --filter='@proma/server' db:create-local && bun run server:db:migrate && bun run --filter='@proma/server' db:seed-local
