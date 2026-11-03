# YouTD Reforged: the game (Vite build) and the online API in one Node process.
# Build: docker build -t youtd-reforged .   Run: see compose.yaml and docs/online.md.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are only needed by wrangler (local Cloudflare tooling), not by the build.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build && npm run check:sim

# The server needs no npm packages: worker/, server/ and src/ use only Node built-ins.
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/wrangler.jsonc ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/worker ./worker
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/me').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
