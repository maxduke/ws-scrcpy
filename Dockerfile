# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache \
    g++ \
    make \
    python3

COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=optional --no-audit --no-fund

COPY . .

RUN npm run dist \
    && npm prune --omit=dev --omit=optional --no-audit --no-fund

FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="ws-scrcpy" \
      org.opencontainers.image.description="Web client for scrcpy" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache \
    android-tools \
    dumb-init

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY --from=build /app/dist ./
COPY --from=build /app/node_modules ./node_modules

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8000/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
