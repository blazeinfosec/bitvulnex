FROM node:22-alpine
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

RUN apk add --no-cache openssl libc6-compat

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/bitcoin-mock ./apps/bitcoin-mock

RUN pnpm install --filter @bvbe/bitcoin-mock... --no-frozen-lockfile
RUN pnpm --filter @bvbe/db exec prisma generate

WORKDIR /repo/apps/bitcoin-mock
EXPOSE 18443
CMD ["pnpm", "tsx", "src/server.ts"]
