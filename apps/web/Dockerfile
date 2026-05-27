FROM node:22-alpine
WORKDIR /repo

# Prisma on alpine needs OpenSSL + libc compatibility shim for the
# linux-musl-openssl-3.0.x engine binary it picks for this platform.
RUN apk add --no-cache openssl libc6-compat

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY CHANGELOG.md ./CHANGELOG.md
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --filter @bvbe/web... --frozen-lockfile
RUN pnpm --filter @bvbe/db exec prisma generate

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "next", "dev", "-p", "3000"]
