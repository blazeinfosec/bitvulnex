FROM node:22-alpine
WORKDIR /repo

RUN apk add --no-cache openssl libc6-compat

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --filter @bvbe/db... --frozen-lockfile
RUN pnpm --filter @bvbe/db exec prisma generate

WORKDIR /repo/packages/db
# One-shot: apply migrations then seed; exit with status code.
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm tsx prisma/seed.ts"]
