---
type: "query"
date: "2026-09-09T08:05:34.449906+00:00"
question: "now, how can I run this application completely?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["README.md", "server/package.json", "web/package.json", "1. Frontend: Next.js Agent Workspace (`apps/web`)", "2. Execution server (`apps/server`)"]
---

# Q: now, how can I run this application completely?

## Answer

Expanded from original query via graph vocab: [run, setup, start, frontend, backend, server, client, api, readme, environment, config, database]. The current application is the Next.js studio in apps/web plus the Hono execution server in apps/server. Install with pnpm install, configure server-side provider credentials, then run pnpm dev; UI defaults to port 3000 and API to port 4000. Durable memory additionally requires the isolated pgvector Compose service, MEMORY_DATABASE_URL, and explicit migrations. The infrastructure/docker stack runs the legacy CLI and observability tools, not the current web studio.

## Outcome

- Signal: useful

## Source Nodes

- README.md
- server/package.json
- web/package.json
- 1. Frontend: Next.js Agent Workspace (`apps/web`)
- 2. Execution server (`apps/server`)