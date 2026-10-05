# BookStack MCP in Agent Studio workflows

Agent Studio's MCP tool executor speaks Streamable HTTP. A BookStack MCP server
registered with a separate Codex installation over stdio is not automatically
available to Agent Studio agents or workflow nodes. Assigning a tool ID to a CLI
agent does not install that MCP server in the isolated CLI worker.

For a live workflow, run the same `bookstack-mcp` package as a server-owned
Streamable HTTP service and expose only its `/mcp` endpoint to Agent Studio.
The package documents `MCP_TRANSPORT=http`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT`,
and `MCP_HTTP_PATH` at
<https://github.com/ttpears/bookstack-mcp/blob/main/README.md>.
Keep `BOOKSTACK_ENABLE_WRITE=false` for discovery. Bind to a private interface
and put an authenticated gateway in front of the MCP service. The gateway must
validate the bearer token leased by Agent Studio. Store the BookStack API
credential and gateway bearer secret in the server's managed secret store;
never place either in a workflow, agent prompt, tool record, repository, or log.

Configure the execution server with a server-owned endpoint
`TOOL_MCP_BOOKSTACK_URL` and a `mcp/bookstack` credential alias (the development
gateway environment name is `TOOL_MCP_BOOKSTACK_TOKEN`). Register separate
read-only `mcp` Tool records for `search_content`, `get_page`, and any other
needed read calls, each with `configuration.server=bookstack` and
`configuration.tool=<tool name>`. Put those tool nodes before the discovery
agent and pass their bounded results, source URLs, and failures downstream.
The workflow must mark an MCP call failure as a blocker and continue with
already accessible sources. Do not infer direct wiki access from a successful
Codex-side MCP call or from a local source snapshot.

When no managed HTTP endpoint is available, a human operator may fetch a
read-only, provenance-labelled snapshot through the current Codex BookStack
MCP connector and provide its path as workflow input. This is a bounded source
handoff, not live MCP access inside Agent Studio. Record the snapshot date,
page IDs/URLs, and the limitation in discovery and final disposition.
