# Convenience targets for the reference server stack (server/docker-compose.yml).
# Every target runs Compose against server/ so it works from the repository
# root; ARGS passes extra flags through (e.g. `make bootstrap ARGS=--lan`,
# `make logs ARGS=ingest`).

COMPOSE       := docker compose --project-directory server -f server/docker-compose.yml
COMPOSE_BUILD := $(COMPOSE) -f server/compose.build.yml
ARGS          ?=

.PHONY: help bootstrap up down pull logs ps migrate baseline pairing dev-up \
        backup backup-list restore

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{ printf "  %-10s %s\n", $$1, $$2 }'

bootstrap: ## First run: create server/.env, start the stack, print the pairing block (ARGS=--lan|--url ...|--time-zone ...)
	scripts/bootstrap.sh $(ARGS)

up: ## Start (or update) the stack from the published images; migrate runs first
	$(COMPOSE) up -d $(ARGS)

down: ## Stop the stack (data volumes are kept; `down -v` would destroy them)
	$(COMPOSE) down $(ARGS)

pull: ## Pull the images for PULS_VERSION (then `make up` to switch to them)
	$(COMPOSE) pull $(ARGS)

logs: ## Follow logs (ARGS=<service> for one service)
	$(COMPOSE) logs -f --tail=200 $(ARGS)

ps: ## Container status
	$(COMPOSE) ps $(ARGS)

migrate: ## Apply pending schema migrations by hand (also runs on every `up`)
	$(COMPOSE) run --rm migrate

baseline: ## Adopt a database created before the migrate service existed (one-time)
	$(COMPOSE) run --rm migrate baseline

pairing: ## Re-print the pairing block (URL, token, user ID, QR) from server/.env
	scripts/bootstrap.sh --print-pairing

dev-up: ## Build the four app images from this checkout and start the stack
	DEPLOY_COMMIT=$$(git rev-parse HEAD 2>/dev/null || echo unknown) $(COMPOSE_BUILD) up -d --build $(ARGS)

backup: ## Take one database dump now (scheduled dumps: docker compose --profile backup up -d)
	$(COMPOSE) --profile backup run --rm backup once

backup-list: ## List the dumps in the backup store
	$(COMPOSE) --profile backup run --rm backup list

restore: ## Restore a dump, DESTROYING the current database (FILE=<path or name from backup-list>)
	@test -n "$(FILE)" || { echo "usage: make restore FILE=<dump path, or a name from 'make backup-list'>"; exit 1; }
	server/backup/restore.sh $(ARGS) "$(FILE)"
