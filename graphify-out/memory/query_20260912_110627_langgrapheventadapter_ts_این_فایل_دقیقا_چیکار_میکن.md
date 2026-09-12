---
type: "query"
date: "2026-09-12T11:06:27.854225+00:00"
question: "langGraphEventAdapter.ts این فایل دقیقا چیکار میکنه؟"
contributor: "graphify"
outcome: "useful"
source_nodes: ["LangGraphEventAdapter", "adapt()", "redact()", "runExecutor.ts"]
---

# Q: langGraphEventAdapter.ts این فایل دقیقا چیکار میکنه؟

## Answer

Expanded from original query via graph vocab: [langgraph, event, adapter, stream, message, state, tool, agent, run, update, custom, token]. LangGraphEventAdapter converts LangGraph streamEvents v3 raw events into internal RunEvent records. It ignores non-event envelopes, resolves nodeId from params.node or namespace[0], redacts payload data, maps tasks to node.completed and other methods to log, and can synthesize agent.completed for agent task events. In RunExecutor, synthesized agent lifecycle events are filtered because AgentRuntime is authoritative. The shared redact helper masks secret-bearing keys and token-like strings, limits nesting/array/string size, and is reused by run storage, APIs, and logging.

## Outcome

- Signal: useful

## Source Nodes

- LangGraphEventAdapter
- adapt()
- redact()
- runExecutor.ts