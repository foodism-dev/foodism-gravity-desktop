SERVER_ENV ?= backend/.env
LOAD_SERVER_ENV = set -a; [ ! -f "$(SERVER_ENV)" ] || . "$(SERVER_ENV)"; set +a;

.PHONY: dev run-api migrate-local

dev:
	bun run dev

run-api:
	@$(LOAD_SERVER_ENV) bun run server:start

migrate-local:
	@$(LOAD_SERVER_ENV) bun run --filter='@proma/server' db:create-local && bun run server:db:migrate && bun run --filter='@proma/server' db:seed-local
