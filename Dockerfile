# Siavash web panel for Liara (platform: docker). See README "دیپلوی پنل روی لیارا".
FROM node:24-slim AS build
WORKDIR /app
RUN npm i -g pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

FROM node:24-slim
WORKDIR /app
# liara CLI: env:list / plan:list have no REST equivalent (see docs/API_LIMITS.md)
RUN npm i -g @liara/cli@9.6.0 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    SIAVASH_UI_HOST=0.0.0.0 \
    PORT=3000 \
    SIAVASH_DATA_DIR=/app/.siavash \
    LIARA_MODE=mock \
    LLM_MODE=mock
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY config ./config
EXPOSE 3000
CMD ["node", "dist/ui/cli/index.js", "ui"]
