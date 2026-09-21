---
type: "query"
date: "2026-09-20T11:20:10.550008+00:00"
question: "How can we completely fix weaker CLI agent codebase understanding caused by lack of IDE-style indexing?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["graphify", "AgentRuntime", "McpToolExecutor", "CliAgentExecutor", "Context Budget"]
---

# Q: How can we completely fix weaker CLI agent codebase understanding caused by lack of IDE-style indexing?

## Answer

Expanded via graph vocabulary: graphify, index, retrieval, search, context, agent, tool, runtime, memory, workflow. No single index completely guarantees correct code. The reliable solution is a provider-independent context gateway combining lexical search, symbol intelligence, semantic and graph retrieval, commit history, incremental worktree overlays, mandatory pre-edit retrieval, and post-edit verification. This repository already has a Graphify query/update rule, but the current AgentRuntime sends only conversation history and memory context to the CLI executor; MCP or Graphify code intelligence is not automatically available inside CLI agents. Integrate the index as MCP directly into each CLI worker or extend the runtime tool protocol, then evaluate retrieval recall and task test-pass rates.

## Outcome

- Signal: useful

## Source Nodes

- graphify
- AgentRuntime
- McpToolExecutor
- CliAgentExecutor
- Context Budget