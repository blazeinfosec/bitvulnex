FROM node:22-alpine
WORKDIR /repo

# Prisma client (pulled transitively via @bvbe/shared -> @bvbe/db)
# needs OpenSSL + libc6-compat for its alpine musl engine.
RUN apk add --no-cache openssl libc6-compat

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/ws-gateway ./apps/ws-gateway

RUN pnpm install --filter @bvbe/ws-gateway... --no-frozen-lockfile
RUN pnpm --filter @bvbe/db exec prisma generate

WORKDIR /repo/apps/ws-gateway
EXPOSE 3001
CMD ["pnpm", "tsx", "src/server.ts"]
