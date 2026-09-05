FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY cli ./cli
COPY test ./test
COPY migrations ./migrations
RUN npm run build

FROM build AS test
USER node
CMD ["node", "--test", "dist/test/*.test.js"]

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
WORKDIR /app
ENV NODE_ENV=production GOZNE_HOST=0.0.0.0 GOZNE_DATABASE=/app/state/gozne.sqlite
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
    && mkdir /app/state && chown node:node /app/state
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/dist/cli ./dist/cli
COPY migrations ./migrations
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN ln -s /app/dist/cli/gozne.js /usr/local/bin/gozne && chmod 0755 /app/dist/cli/gozne.js
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "dist/cli/gozne.js", "serve"]
