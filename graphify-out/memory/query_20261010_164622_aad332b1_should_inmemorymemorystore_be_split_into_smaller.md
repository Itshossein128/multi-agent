---
type: "query"
date: "2026-10-10T16:46:22.372963+00:00"
question: "Should InMemoryMemoryStore be split into smaller, more focused modules?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["InMemoryMemoryStore", "PostgresMemoryStore"]
---

# Q: Should InMemoryMemoryStore be split into smaller, more focused modules?

## Answer

Expanded from original query via vocab: [memory, store, split, module, modules, focus, focused]. Then traversed InMemoryMemoryStore community in graph.json. InMemoryMemoryStore itself is an 82-line in-memory test adapter in src/memory/infrastructure/in-memory-memory-store.ts. The low cohesion score (0.0599) in the report was for the whole storage infrastructure community, which groups PostgresMemoryStore, InMemoryMemoryStore, storage-utils.ts, and migration scripts together. InMemoryMemoryStore itself should not be split.

## Outcome

- Signal: useful

## Source Nodes

- InMemoryMemoryStore
- PostgresMemoryStore