# Mijn Bereyl – één image voor webserver en worker
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STORAGE_DIR=/data/storage
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/storage && chown -R node:node /data
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Standaard: controle, migraties, startgegevens en webserver. De worker gebruikt hetzelfde image met een ander commando.
CMD ["sh", "-c", "npm run check:prod && npm run db:migrate && npm run db:seed && npx next start -p 3000"]
