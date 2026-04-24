FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Use Debian (glibc) so Railpack's internal tooling (mise) runs correctly.
# Alpine uses musl which breaks dynamically-linked binaries that Railpack downloads.
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io curl bash git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Railpack from GitHub releases (musl binary — statically linked, runs on any Linux)
RUN curl -fsSL https://github.com/railwayapp/railpack/releases/download/v0.23.0/railpack-v0.23.0-x86_64-unknown-linux-musl.tar.gz \
    | tar -xz -C /usr/local/bin/ \
    && chmod +x /usr/local/bin/railpack

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data/logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
