.PHONY: up down reset seed logs test flags build install

install:
	pnpm install

up:
	docker compose up -d

down:
	docker compose down

reset:
	bash scripts/reset-lab.sh

seed:
	pnpm --filter @bvbe/db seed

logs:
	docker compose logs -f web

test:
	pnpm -r test

build:
	pnpm -r build

flags:
	pnpm tsx scripts/derive-flags.ts
