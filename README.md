# Brimble Deploy

A one-page deployment pipeline: submit a Git URL or zip archive, watch it build into a container image via Railpack, run behind Caddy, and stream logs live.

```
docker compose up
```

Frontend → http://localhost:5173  
Backend API → http://localhost:3000  
Deployed apps → http://localhost:8080/deploy/{id}

---

## What it does

1. **Submit** a Git URL or zip upload via the UI
2. **Backend** clones/extracts the source, calls `railpack build` to produce a Docker image
3. **Container** is started with `docker run`, mapped to a host port starting at 4000
4. **Caddy** gets a new reverse-proxy route registered via its Admin API (no restart needed)
5. **Logs** stream live to the UI over SSE while the build runs, and persist in SQLite for scroll-back after

---

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | TypeScript + Express | Preferred per spec; strong typing helps with the pipeline state machine |
| Database | SQLite (better-sqlite3) | No extra service, WAL mode handles concurrent reads fine at this scale |
| Frontend | Vite + TanStack Router + Query | Required per spec; Query handles polling and cache invalidation cleanly |
| Log streaming | SSE | Logs are unidirectional  SSE is simpler than WebSocket, works through proxies, and the browser EventSource API handles reconnection automatically |
| Ingress | Caddy 2 | Admin API lets the backend register routes at runtime without any reload |
| Builds | Railpack | Detects language, produces a runnable image, no Dockerfile to maintain |

---

## Architecture

```
Browser
  │  HTTP + SSE
  ▼
nginx (frontend container, :5173)
  │  /api/* proxy
  ▼
Express API (:3000)
  │  SQLite (deployments + logs)
  │  Docker socket (spawn builds + containers)
  │  HTTP (Caddy Admin API :2019)
  ▼
Caddy (:80)
  │  /deploy/{id}/* → host.docker.internal:{port}
  ▼
Deployed containers (:4000, :4001, …)
```

The backend mounts `/var/run/docker.sock` so it can call `docker` as a sibling process — deployed containers are siblings of the backend container, not children. Caddy reaches them via `host.docker.internal:{port}` (the `extra_hosts: host-gateway` entry in compose makes this work on Linux).

### Dynamic Caddy routing

Caddy starts with an empty `:80` server and the Admin API exposed on `0.0.0.0:2019`. When a deployment goes live, the backend POSTs a new reverse-proxy route to `/config/apps/http/servers/srv0/routes`. Teardown does a GET → filter → PUT to remove the route. No Caddy reload required.

One known limitation: routes live in Caddy's in-memory config. A Caddy restart drops all dynamic routes. In production you'd either persist the JSON config or re-register on startup by reading the DB.

### Log streaming

Every pipeline step writes to three sinks simultaneously: SQLite (for persistence), an in-memory SSE fan-out map (for live clients), and a flat log file under `data/logs/`. When a client connects mid-build it replays existing DB rows then switches to live push. When a client connects after the build it gets the full replay and an immediate `done` event. A 15-second heartbeat comment keeps the connection alive through proxies.

### Port allocation

`allocatePort()` runs `SELECT MAX(container_port) + 1` inside a SQLite transaction. Simple and correct under concurrent deploys (SQLite serialises writers). It does not reclaim ports after deletion — with more time I'd use a port pool table.

---

## Prerequisites

- Docker (with Compose v2)
- Nothing else — Railpack and all tooling are installed inside the backend image

---

## Running

```bash
git clone https://github.com/UgwuObed/brimble-deploy
cd brimble-deploy
docker compose up --build
```

Open http://localhost:5173. Paste a Git URL (or upload a zip) and click Deploy.

To test end-to-end with a ready-made app, use:

```
https://github.com/UgwuObed/hello-brimble
```

### Environment variables

All have sensible defaults. Override in `docker-compose.yml` if needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Backend listen port |
| `DB_PATH` | `/app/data/brimble.db` | SQLite file path |
| `LOGS_DIR` | `/app/data/logs` | Flat log file directory |
| `CADDY_ADMIN_URL` | `http://caddy:2019` | Caddy Admin API base URL |
| `CONTAINER_PORT_START` | `4000` | First host port for deployed containers |
| `DEPLOY_HOST` | `localhost:8080` | Hostname used to construct public deployment URLs |

---

## API

```
GET    /api/deployments              List all deployments
POST   /api/deployments              Create (JSON { gitUrl } or multipart zipFile)
GET    /api/deployments/:id          Get single deployment
DELETE /api/deployments/:id          Stop container + remove Caddy route + delete record
GET    /api/deployments/:id/logs     All persisted log entries
GET    /api/deployments/:id/logs/stream  SSE stream (live during build, replay after)
GET    /api/health                   Health check
```

---

## Sample app

`sample-app/` is a zero-dependency Node.js HTTP server. It serves a status page showing the deployment ID and start time. Railpack detects it as a Node.js app via `package.json` and produces a runnable image with no Dockerfile.

To test the pipeline end-to-end, paste this URL into the deploy form:

```
https://github.com/UgwuObed/hello-brimble
```

---

## What I'd change with more time

**Port reclamation** — `allocatePort` uses `MAX + 1` and never recycles. A small `port_pool` table (status: free/allocated) would be more correct.

**Caddy config persistence** — Dynamic routes are lost if Caddy restarts. On startup the backend could re-register all `running` deployments from the DB.

**Zero-downtime redeploy** — Start the new container, wait for it to be healthy, swap the Caddy route, then stop the old container. The pieces are all there; it's a sequencing problem.

**Build cache** — Railpack supports cache mounts. Passing `--cache-from` on repeat builds of the same repo would cut build times significantly.

**Zip root detection** — When a zip has a single root directory, the pipeline currently extracts into the work dir as-is. It should detect and unwrap the root directory so Railpack sees the project files at the top level.

**Better pipeline observability** — The pipeline is a single async function. Splitting it into named stages with per-stage status would make failure diagnosis much easier (and is closer to how real CI systems work).

---

## Time spent

~12 hours total: ~5h backend + pipeline, ~3h frontend, ~2h Docker/Caddy wiring, ~2h debugging and fixes.
