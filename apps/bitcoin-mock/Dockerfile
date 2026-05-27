FROM node:22-alpine
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/bitcoin-rpc-types ./packages/bitcoin-rpc-types
COPY apps/bitcoin-mock ./apps/bitcoin-mock

RUN pnpm install --filter @bvbe/bitcoin-mock... --frozen-lockfile=false

WORKDIR /repo/apps/bitcoin-mock
EXPOSE 18443
CMD ["pnpm", "tsx", "src/server.ts"]
