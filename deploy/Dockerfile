# syntax=docker/dockerfile:1
# Image unique du monorepo, cibles : migrate, api, worker, web.
# NON CONSTRUITE sur le poste de développement (démon Docker indisponible) : à valider en CI ou
# sur l'hôte de staging avant usage. Épingler l'image de base par empreinte (digest) en production.
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.15.0
WORKDIR /app

FROM base AS build
COPY . .
# Les réécritures /v1 de Next sont figées au build : adresse interne de l'API dans le réseau Docker.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm install --frozen-lockfile \
 && pnpm db:generate \
 && pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node

FROM runtime AS migrate
WORKDIR /app/packages/database
CMD ["npx", "prisma", "migrate", "deploy"]

FROM runtime AS api
WORKDIR /app/apps/api
ENV API_HOST=0.0.0.0 API_PORT=4000
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM runtime AS worker
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

FROM runtime AS web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
