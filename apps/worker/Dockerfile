FROM node:22-alpine
WORKDIR /repo

RUN apk add --no-cache openssl libc6-compat

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --filter @bvbe/worker... --no-frozen-lockfile
RUN pnpm --filter @bvbe/db exec prisma generate

WORKDIR /repo/apps/worker
CMD ["pnpm", "tsx", "src/index.ts"]
