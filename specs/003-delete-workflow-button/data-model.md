# Data Model: Delete Workflow Button

**Feature**: `003-delete-workflow-button`  
**Date**: 2026-10-04  
**Related**: [spec.md](./spec.md), [research.md](./research.md), [contracts/delete-workflow.openapi.yaml](./contracts/delete-workflow.openapi.yaml)

## Entities

No new persisted entities. Deletion removes an existing **Workflow** row/record. Client-only confirmation is ephemeral UI state.

### Workflow (existing)

| Field | Type | Rules relevant to delete |
|-------|------|---------------------------|
| `id` | string | Stable identifier; path parameter for delete |
| `name` | string | Shown in confirmation copy; human-readable label (FR-003) |
| `ownerId` | string | Must match authenticated principal user for successful delete |
| `tenantId` | string | Must match authenticated principal tenant |
| `nodes` / `edges` / … | definition payload | Removed with the workflow; not partially retained |
| `updatedAt` | string (ISO) | Irrelevant after delete |

**Validation / authorization (server, existing)**:
- Unauthenticated → reject
- Wrong owner or tenant → fail closed without successful delete (non-owner typically indistinguishable not-found)
- Successful delete → workflow absent from subsequent `list` / `get` for all principals

**Lifecycle**:

```text
[Exists, owned] --confirm+authorized DELETE--> [Permanently removed]
[Exists, owned] --cancel confirm--> [Unchanged]
[Exists, not owned / missing] --DELETE--> [Unchanged; error to caller]
```

### Delete Confirmation (client-only, ephemeral)

| Field | Type | Rules |
|-------|------|--------|
| `workflowId` | string | Must equal the workflow being deleted |
| `workflowName` | string | Copied into confirm message before prompt |
| `permanent` | boolean | Always treated as true in copy (“cannot be undone”) |
| `discardUnsaved` | boolean | True when editor dirty for that workflow |

Not persisted. Exists only for the duration of the confirm dialog / handler.

### Active Workflow Pointer (client storage)

| Field | Type | Rules |
|-------|------|--------|
| Active workflow id | string \| null | Browser storage key used by `workflowService`; **must be cleared or replaced** when it matches a successfully deleted id |

## Relationships

- **Principal → Workflow**: ownership gates mutate/delete; list returns only accessible workflows.
- **Run / Task → Workflow** (optional historical): may retain `workflowId` after delete; out of scope to cascade-delete those records in v1.
- **Agent / Tool registries**: independent; deleting a workflow does not delete shared agents/tools (nodes on other workflows remain).

## Integrity rules

1. Delete is all-or-nothing for the workflow definition record.
2. Cancel/dismiss confirmation performs zero writes.
3. After success, clients must not keep presenting the deleted id as a selectable saved workflow.
4. Forging `ownerId` / `tenantId` on unrelated payloads must not grant delete (already enforced on create/save; delete uses principal + store filters only).
