# Shared workspace packages

Workspace packages are JSON snapshots of workflows plus the agents and tools they reference. Importing stamps them into **your** signed-in organization (`ownerId` / `tenant_id`).

## PISA Organization

- File: [`pisa-organization-workflow.json`](./pisa-organization-workflow.json)
- Contents: 1 workflow, 10 agents, 2 tools
- Also served at `/workspaces/pisa-organization-workflow.json` when the web app is running

### Import (UI)

1. Sign in and open **Org** (`/org`).
2. Click **Install PISA sample**, or **Import package** and choose the JSON file.
3. Open `/org?workflowId=pisa-organization-workflow`.

### After import

CLI agents use Codex. Set `CLI_AGENT_ENABLED` and workspace allowlists on the server, and set each agent’s **workspace root** to a path on your machine if needed (machine-local paths were stripped from the shared package).
