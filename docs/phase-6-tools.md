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

**Test tool** posts the saved tool and a JSON input object to `POST /tools/test`. The `function` category is implemented (`FunctionToolExecutor` in `src/tools/functionToolExecutor.ts`) for a safe local echo. The explicit `repo-tests` kind is a separate opt-in capability: it is disabled by default, validates real paths against server-owned workspace roots, and executes Node tests and `git diff` only through the configured local/container `WorkerRuntime` with bounded time and output. `repo-checks` is a second opt-in kind for a repository verification gate. Its `configuration.checks` is a comma-separated list from the fixed set `test,typecheck,build,lint,diff`; `build` runs the server-selected package manager's fixed `run build` script in an explicitly read-write disposable workspace, while other checks are read-only. It never accepts an arbitrary command string. Database, search, and MCP categories now execute through server-owned endpoints and a short-lived, single-use, principal-bound credential gateway; tool configuration contains aliases only. The gateway is disabled by default and fails closed. Local mode is trusted-only; container mode is the recommended boundary for untrusted repositories. File, CLI, and custom categories remain explicit unsupported capabilities. HTTP execution remains available subject to `ToolRuntime` policy.

## Existing platform limits

- Tools remain browser-local Studio storage, same as agents — no cross-device sync or concurrent multi-tab conflict resolution.
- The `function` category's default behavior is data-only; `repo-tests` and `repo-checks` are the only process-executing kinds and remain disabled unless explicitly enabled through server configuration.
- `impact`/permission metadata is stored and validated, but it is not yet a complete runtime approval policy (no generic per-agent/workflow/environment restriction). This remains a follow-up; see [implementation gaps](implementation-gaps.md).
- `inputSchema`/`outputSchema` are stored as free-form JSON objects; there is no schema-driven validation of tool calls yet.

## Verification

`tests/toolRegistry.test.ts` covers v2→v3 workspace migration, registry CRUD, duplication, credential rejection, and delete-blocked/cascade behavior across both workflow nodes and agent assignments. `tests/toolValidation.test.ts` covers `validateTool` constraints. `tests/toolExecution.test.ts` covers `POST /tools/test`: the function-category echo, the explicit not-implemented path, credential rejection, disabled-tool rejection, WorkerRuntime delegation, bounded local execution, symlink escape rejection, fixed `repo-checks` dispatch, per-check failure reporting and arbitrary-command rejection.
