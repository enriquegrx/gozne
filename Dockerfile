FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base
# Security update for CVE-2026-14456; keep both OpenSSL packages at the same version.
RUN apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY cli ./cli
COPY test ./test
COPY examples/login ./examples/login
COPY migrations ./migrations
RUN npm run build

FROM build AS test
USER node
CMD ["node", "--test", "dist/test/*.test.js"]

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production GOZNE_HOST=0.0.0.0 GOZNE_DATABASE=/app/state/gozne.sqlite
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
    && mkdir /app/state && chown node:node /app/state \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/dist/cli ./dist/cli
COPY migrations ./migrations
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN ln -s /app/dist/cli/gozne.js /usr/local/bin/gozne && chmod 0755 /app/dist/cli/gozne.js
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "dist/cli/gozne.js", "serve"]
