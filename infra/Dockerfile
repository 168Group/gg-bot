FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.34.5
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install --yes --no-install-recommends unzip ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.34.5
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/modules/logging/db ./modules/logging/db
COPY --from=build /app/infra/pocketbase ./infra/pocketbase
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
CMD ["node", "dist/web/main.js"]
