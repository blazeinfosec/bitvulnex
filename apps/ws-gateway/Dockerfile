FROM node:22-alpine
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/ws-gateway ./apps/ws-gateway

RUN pnpm install --filter @bvbe/ws-gateway... --frozen-lockfile

WORKDIR /repo/apps/ws-gateway
EXPOSE 3001
CMD ["pnpm", "tsx", "src/server.ts"]
