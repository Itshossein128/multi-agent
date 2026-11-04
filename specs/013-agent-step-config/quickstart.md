# Quickstart: Independent Agent Configuration Per Workflow Step

**Feature**: `013-agent-step-config`  
**Purpose**: Validate the feature end-to-end after implementation—without embedding full test suites here.

See also: [data-model.md](./data-model.md), [contracts/agent-step-config.contract.ts](./contracts/agent-step-config.contract.ts), [contracts/agent-step-config.schema.md](./contracts/agent-step-config.schema.md).

---

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- Types buildable (`pnpm --filter @multi-agent/types build` or project equivalent)
- For manual studio check: `pnpm run dev` (web + server), an org project with at least one **API** agent that has ≥2 allowed tools, and ability to create/run workflows

---

## 1. Unit / contract tests (primary gate)

```bash
pnpm test --runInBand tests/agentStepConfig.test.ts
pnpm test --runInBand tests/agentStepConfigExecution.test.ts
```

**Expect** (map to SC-001–SC-010 / acceptance scenarios):

| Case | Expect |
| :--- | :--- |
| Partial model override + `temperature: 0` | Effective temperature is `0`; other keys inherit |
| Clear override | Key absent from stored override; effective returns to base |
| `activeTools` omitted vs `[]` vs subset | Inherit / none / subset; invalid superset rejected |
| Resolve purity | Shared agent object identity/content unchanged after resolve |
| Two effective configs same agent | Different instructions/tools/settings; no cross-leak |
| Unsupported override on cli/process/webhook | Validation error (not silent accept) |
| Base agent switch with stale tool ids | Incompatibility blocks; `taskInstruction` preserved |
| API executor with step instruction | Base system prompt unchanged; step text delivered additively; input still present |
| API ReAct with restricted `activeTools` | Only effective tools bound; out-of-set call not executed |
| Snapshot/immutability helper (if covered) | Post-start draft edit does not change snapshotted node config used by run |

Optional regressions:

```bash
pnpm test --runInBand tests/apiAgentExecutorReAct.test.ts
pnpm test --runInBand tests/agentExecutor.test.ts
```

---

## 2. Typecheck / build

```bash
pnpm exec tsc --noEmit
pnpm --filter @multi-agent/types build
```

**Expect**: clean compile with extended `AgentNodeConfig` and shared resolve/validate exports.

---

## 3. Manual studio smoke (optional)

1. Open Workflow Editor; add **two** agent nodes linked to the **same** base Agent.
2. On Node A set Step Instructions to “Generate code from the specification.”
3. On Node B set Step Instructions to “Fix bugs reported by QA.”
4. On Node A set a model override (e.g. temperature `0`) and restrict Active Tools to a proper subset; leave Node B inheriting tools.
5. Confirm properties panel does **not** edit base name/system prompt/backend; registry `updatedAt` unchanged after step edits (reload agent detail if needed).
6. Save workflow; reload editor → step fields intact on A and B independently.
7. Use **Edit Agent in Registry** → confirm shared-impact warning → agent detail opens without an accidental save.
8. Run the workflow (Live if available):
   - Node A execution reflects A’s instruction, temperature `0`, and restricted tools.
   - Node B execution reflects B’s instruction and inherited tools/settings.
9. In a second workflow referencing the same Agent, confirm it was unaffected by step edits in the first workflow.
10. Start a run, then edit Node A’s instruction while the run is in progress → in-progress run behavior remains on pre-edit snapshot; new runs pick up the draft after save/start.
11. Open a **legacy** workflow (no new fields) → runs without forced reconfiguration.
12. Switch Node A to a different base Agent that lacks one of A’s active tools → UI/validation shows incompatibility; run blocked until fixed.
13. Attempt model override on a CLI-backed agent (if available) → actionable unsupported error, not silent success.

**Expect**: SC-001–SC-010 behaviors observable from the operator’s perspective.

---

## 4. Security spot-checks

- With restricted `activeTools`, force/simulate a tool request outside the effective set → tool must not execute.
- Confirm step overrides do not disable approval / `mutatesCode` / credential / execution-policy controls on a known gated path.
- Confirm node panel cannot change backend provider/model or execution policy without Registry path.

---

## Out of scope for this quickstart

- New prompt interpolation / `{{node.output}}` mapping
- Registry IA redesign beyond the deep-link + warning
- Workflow publish/version product
- ReAct for CLI/worker adapters
- Other visual-platform findings (ports, archetypes, approval handles, etc.)
