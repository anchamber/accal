# Stage 1: Install dependencies
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# Stage 2: Build frontend
FROM deps AS build-web
WORKDIR /app
COPY . .
RUN cd apps/web && pnpm exec vp build

# Stage 3: Build server
FROM deps AS build-server
WORKDIR /app
COPY . .
RUN cd apps/server && pnpm exec vp pack

# Stage 4: Production
FROM node:22-slim AS production
WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --prod

COPY --from=build-web /app/apps/web/dist ./public
COPY --from=build-server /app/apps/server/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/accal.db

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist/index.mjs"]
