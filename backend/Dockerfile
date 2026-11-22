# FixIt API image. PostgreSQL runs in its own container (the "db" service in
# docker-compose.yml); this image is only the Node.js API.
#
#   docker compose --profile app up -d --build

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/data/uploads
WORKDIR /app

# Dependencies first, so Docker can reuse this layer when only the code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY samples ./samples

# Run as the unprivileged "node" user. The uploads folder must be owned by it before the
# volume is mounted there, so a fresh volume starts out writable.
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run inside the API on startup, so a new image upgrades the database itself.
CMD ["node", "src/server.js"]
