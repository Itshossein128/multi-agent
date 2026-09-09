# Tool registry

Open the independent registry at `/org/tools`, or use **Details** in the Graph Editor palette. Individual tools live at `/org/tools/<toolId>`.

Tools follow the same Entity ↔ Node split Phase 5 introduced for agents:

```text
Tool Entity (registry, reusable)
    ↓ referenced by
Tool Node in Workflow (config: { toolId })
    ↓ referenced by
AgentRecord.tools (assignment, an array of tool IDs)
```

`ToolNodeConfig` is now `{ toolId: string | null }` — configuration (name, description, category, input/output schema, `configuration`, `enabled`, `impact`) lives on the `ToolRecord` in the registry and is shared across every node/agent that references it, the same way `AgentNodeConfig` only carries `agentId`.

## Migration from Phase 3/5 inline tool nodes

Earlier saved workflows stored `{ toolId, name, description, config }` directly on the node. `workflowService` upgrades the browser workspace from `agent-studio.workspace.v2` to `.v3` on first read: each legacy tool node is converted into a registry `ToolRecord` (reusing its old `toolId` as the record id when free) and the node is rewritten to `{ toolId }`. This is one-shot and idempotent — see `migrateWorkflowToolNodes` in `packages/types/src/index.ts` and `upgradeFromV2` in `apps/web/src/services/workflowService.ts`.

## Configuration and navigation

General configuration (name, category, impact/permission level, description, `configuration` JSON, enabled) is edited the same way agent configuration is: pending draft, Save/Cancel, credential rejection via `assertNoCredentials`/`validateTool`. Duplicate creates an independent ID and deep copy. Deletion is blocked while any saved workflow tool node or any agent's `tools` list references the tool, with instructions to remove those first — `deleteTool(toolId, { removeReferences: true })` cascades through both.

The agent detail page's Tools panel (`AgentToolsPanel` in `apps/web/src/components/agents/AgentResources.tsx`) now assigns from the registry via `workflowService.listTools()` instead of scanning saved workflow tool nodes — this resolves the Phase 5 note that tool descriptions were "resolved from saved workflow tool nodes" with "no global Tool Detail route."

## Test tool

**Test tool** posts the saved tool and a JSON input object to `POST /tools/test`. Only the `function` category is implemented (`FunctionToolExecutor` in `src/tools/functionToolExecutor.ts`): a safe local echo that merges `tool.configuration` with the request input and returns it — no network, filesystem, or process access. Every other category (`http`, `database`, `search`, `file`, `mcp`, `cli`, `custom`) reports an explicit `UnsupportedToolCategoryError` via `NotImplementedToolExecutor`, the same pattern CLI/local agent backends use (`src/agents/runtime/notImplementedExecutor.ts`). Building real HTTP/DB/search/MCP execution engines is future work — see Phase 11 (Tool Safety) before wiring up categories with real side effects, since `impact` (`read-only`/`write`/`external`/`high-impact`) is only inspectable metadata today, not an enforced guardrail.

## Existing platform limits

- Tools remain browser-local Studio storage, same as agents — no cross-device sync or concurrent multi-tab conflict resolution.
- Only the `function` category actually executes; all other categories fail explicitly on test.
- `impact`/permission metadata is not yet enforced by the runtime (no approval gating, no per-agent/workflow/environment restriction) — that lands with Phase 11 guardrails.
- `inputSchema`/`outputSchema` are stored as free-form JSON objects; there is no schema-driven validation of tool calls yet.

## Verification

`tests/toolRegistry.test.ts` covers v2→v3 workspace migration, registry CRUD, duplication, credential rejection, and delete-blocked/cascade behavior across both workflow nodes and agent assignments. `tests/toolValidation.test.ts` covers `validateTool` constraints. `tests/toolExecution.test.ts` covers `POST /tools/test`: the function-category echo, the explicit not-implemented path, credential rejection, and disabled-tool rejection.
