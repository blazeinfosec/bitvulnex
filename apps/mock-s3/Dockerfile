FROM node:22-alpine
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/mock-s3 ./apps/mock-s3

RUN pnpm install --filter @bvbe/mock-s3... --frozen-lockfile

WORKDIR /repo/apps/mock-s3
EXPOSE 80
CMD ["pnpm", "tsx", "src/server.ts"]
