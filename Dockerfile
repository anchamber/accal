# Stage 1: Install dependencies (full image for native builds)
FROM node:22 AS deps
WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm -r rebuild better-sqlite3 esbuild

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

# Stage 4: Production deps only
FROM deps AS prod-deps
ENV CI=true
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm -r rebuild better-sqlite3

# Stage 5: Production
FROM node:22-slim AS production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build-web /app/apps/web/dist ./public
COPY --from=build-server /app/apps/server/dist ./apps/server/dist
COPY packages/shared/src ./packages/shared/src

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/accal.db

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "apps/server/dist/index.mjs"]
