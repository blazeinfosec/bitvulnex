.PHONY: up down reset seed logs test flags build install

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

test:
	pnpm test

build:
	pnpm -r build

flags:
	pnpm tsx scripts/derive-flags.ts
