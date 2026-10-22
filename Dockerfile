# syntax=docker/dockerfile:1

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build

ENV PNPM_HOME=/pnpm \
	PATH=/pnpm:$PATH \
	npm_config_nodedir=/usr/local \
	CI=true
RUN corepack enable

WORKDIR /src

# Dependencies first, so code changes don't reinstall them. git: @niijima/design comes from GitHub.
# python3, make, g++: build tools for the native modules (better-sqlite3, sharp) when no
# prebuilt binary can be downloaded.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Production dependencies: only the two native modules (everything else is bundled) ──
FROM node:22-slim AS deps

ENV PNPM_HOME=/pnpm \
	PATH=/pnpm:$PATH \
	npm_config_nodedir=/usr/local \
	CI=true
RUN corepack enable
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

# ── Run ──────────────────────────────────────────────────────────────────────
FROM node:22-slim

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	BODY_SIZE_LIMIT=256M \
	ARCHIVE_CONFIG=/app/settings/config.yml \
	ARCHIVE_DATA=/app/data \
	ARCHIVE_ASSETS=/app/assets \
	ARCHIVE_MIGRATIONS=/app/migrations

WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/build ./build
COPY --from=build /src/migrations ./migrations
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/config.example.yml ./config.example.yml

RUN mkdir -p /app/data /app/assets /app/settings && chown -R node:node /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "build"]
