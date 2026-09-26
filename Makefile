.PHONY: up down reset seed logs test flags build install doctor heal watchdog watchdog-logs

# Host tooling (Node 22 + pnpm 9). Only needed for tests and instructor
# scripts; the lab itself runs entirely in Docker.
install:
	pnpm install
	pnpm --filter @bvbe/db generate

# --build picks up source changes; --renew-anon-volumes refreshes the
# per-service node_modules volumes so a changed lockfile or Prisma
# schema takes effect after a `git pull`.
up:
	docker compose up -d --build --renew-anon-volumes

down:
	docker compose down

reset:
	bash scripts/reset-lab.sh

# Re-runs migrations + seed inside the compose network (the db service
# does not publish a host port, so a host-side seed cannot reach it).
seed:
	docker compose run --rm db-migrate

logs:
	docker compose logs -f web

# Report which web replicas a V-34 trigger has poisoned into permanent
# 500s (see scripts/web-pool-doctor.sh). `heal` recycles only those,
# leaving every other replica's warm compile cache intact.
doctor:
	bash scripts/web-pool-doctor.sh

heal:
	bash scripts/web-pool-doctor.sh --heal --warm

# The V-34 pool watchdog normally runs AUTOMATICALLY as a sidecar
# (COMPOSE_PROFILES=watchdog in .env — starts with `make up`). These
# targets are for when you want it in the foreground or without the
# sidecar:
#   make watchdog        run the debounced watchdog here (Ctrl-C to stop)
#   make watchdog-logs   follow the auto-started sidecar's log
# INTERVAL / THRESHOLD override cadence and strike count.
watchdog:
	WATCHDOG_INTERVAL=$(or $(INTERVAL),10) WATCHDOG_FAIL_THRESHOLD=$(or $(THRESHOLD),3) \
		sh scripts/web-watchdog.sh

watchdog-logs:
	docker compose logs -f web-watchdog

test:
	pnpm test

build:
	pnpm -r build

flags:
	pnpm tsx scripts/derive-flags.ts
