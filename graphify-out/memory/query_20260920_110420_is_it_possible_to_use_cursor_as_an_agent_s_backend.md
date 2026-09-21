---
type: "query"
date: "2026-09-20T11:04:20.976374+00:00"
question: "is it possible to use cursor as an agent's backend?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["AgentBackend", "CliAgentExecutor", "AgentExecutorFactory", "PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES"]
---

# Q: is it possible to use cursor as an agent's backend?

## Answer

Expanded via graph vocabulary: cursor, cli, agent, executor, factory, provider, runtime, command, process, codex, claude. Yes, Cursor can be used through its official headless cursor-agent CLI. This repository generic CLI backend accepts custom provider identifiers, executable and args, passes the prompt on stdin, and returns stdout. A minimal local configuration can use provider cursor, executable cursor-agent, args -p --output-format text, with executable and workspace allowlists. It is not turnkey here: Cursor is absent from UI suggestions, the worker image, and credential delivery; only Codex and Claude have provider-specific defaults and credentials. For production containers, add Cursor CLI to the pinned image, CURSOR_API_KEY delivery, provider defaults/tests, or use Cursor ACP for structured sessions/permissions.

## Outcome

- Signal: useful

## Source Nodes

- AgentBackend
- CliAgentExecutor
- AgentExecutorFactory
- PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES