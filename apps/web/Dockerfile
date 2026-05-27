FROM node:22-alpine
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY CHANGELOG.md ./CHANGELOG.md
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --filter @bvbe/web... --frozen-lockfile=false
RUN pnpm --filter @bvbe/db exec prisma generate

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "next", "dev", "-p", "3000"]
