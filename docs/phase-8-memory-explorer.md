# Memory Explorer

The backend memory system (storage, retrieval, authorization, runtime integration) is documented in [Memory backend](phase-6-memory.md). The Explorer is a deliberately small UI over those APIs; it does not create a second authorization or storage model.

## Access model

`/org/memory` is a thin client over the existing authenticated `apps/server/src/api/memories.ts` routes (`apps/web/src/services/memoryService.ts`). The main Studio now has Auth.js and a server-side BFF, but the memory API still uses its explicit server-provisioned bearer-token contract. The page stores that token in `localStorage` (`agent-studio.memory-token.v1`) purely as a per-browser convenience. The server remains the sole source of authorization: the token's `readableNamespaces`/`writableNamespaces` grants determine what the Explorer can see or delete. A token typo or missing grant surfaces the server's own 401/403 error text.

## What it does

- **List**: `GET /memories?scope&namespaceId&kind` for a chosen namespace, optionally filtered by kind (`semantic`/`episodic`/`procedural`).
- **Search**: `POST /memories/search`, the same relevance-scored recall path agents use at runtime, to inspect what a given query would actually retrieve.
- **Inspect**: expanding a result shows the full `Memory` record (content/structured fields, `importance`, `status`, `source` — including `agentId`/`runId`/`workflowId` provenance — `metadata`, timestamps). Embeddings, content hashes, and tenant IDs are never sent to the browser (`visible()` in `memories.ts` already strips them server-side).
- **Delete**: `DELETE /memories/:id`, confirmed inline, scoped by the token's grants exactly like the API.

## What is still out of scope

- **Editing** (`PATCH /memories/:id`) is not exposed — the roadmap's Phase 8 functional requirements list inspect/search/delete, not in-place editing, so this was left out rather than added speculatively.
- **Automatic backend cleanup on entity deletion** (e.g., deleting an Agent in the Studio registry also purging its memory) remains deferred — the memory API still uses a separate bearer-grant contract, so forcing cleanup through the browser registry would either bypass that boundary or prompt for a token on every entity deletion.
- The Graph Editor's `Memory` workflow node type (`packages/types` `MemoryNodeConfig`) is a separate, pre-existing concept: an in-run LangGraph state channel scoped to one execution (`apps/server/src/compiler/workflowCompiler.ts`), not the long-term backend `MemoryService`. Long-term memory is agent-scoped and automatic via `AgentRecord.memory.longTerm` (`AgentMemoryPanel.tsx`) — wiring the graph node itself to long-term storage was not part of this pass and is a larger, separate design question (namespace resolution per node, access context per node) rather than an Explorer gap.

## Verification

The underlying API is covered by `tests/memoryApi.test.ts` and the memory storage/retrieval/runtime suites. `memoryService.ts` is a thin fetch wrapper; authorization and persistence behavior are verified at the server boundary.
