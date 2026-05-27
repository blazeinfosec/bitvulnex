FROM node:22-alpine
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --filter @bvbe/worker... --frozen-lockfile=false

WORKDIR /repo/apps/worker
CMD ["pnpm", "tsx", "src/index.ts"]
