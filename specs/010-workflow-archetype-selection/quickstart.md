# Quickstart & Validation Guide: Explicit Workflow Archetype Selection and Configuration

**Feature Branch**: `010-workflow-archetype-selection`  
**Date**: 2026-11-03  
**Status**: Ready for Verification  

---

## Overview

This guide provides end-to-end testing procedures and runnable verification scenarios for validating explicit workflow archetype selection, configuration, and conversion across Agent Studio.

---

## Prerequisites & Environment Setup

1. **Repository & Dependencies**:
   ```bash
   pnpm install
   ```
2. **Server & Client Build Check**:
   ```bash
   npx tsc --noEmit
   pnpm --filter server build
   pnpm --filter web build
   ```
3. **Database Environment** (optional for in-memory suites; required for live server):
   ```bash
   # Ensure PostgreSQL container or local instance is running if testing against live database
   export MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
   ```

---

## Automated Test Suites

Run the dedicated test suites covering archetype creation, validation parity, UI forms, and conversion lifecycles:

```bash
# 1. Run all workflow archetype unit & integration test suites
pnpm test tests/workflowArchetypeSchema.test.ts tests/dualModeOrchestration.test.ts tests/workflowSwitcher.test.ts

# 2. Run new dedicated archetype authoring and validation test suites
pnpm test tests/workflowArchetypeAuthoring.test.ts tests/clientWorkflowValidation.test.ts

# 3. Full project regression run
pnpm test --runInBand
```

---

## End-to-End Validation Scenarios

### Scenario 1: Create, Save, and Reopen a Linear Pipeline
1. Navigate to `/o/pga/org` in the browser.
2. Click **New workflow** in the `WorkflowSwitcher` header.
3. In the creation dialog:
   - Enter name: `"Customer Intake Pipeline"`.
   - Select archetype: **Linear Pipeline** (verified default).
   - Click **Create**.
4. Verify the editor loads with the `"Linear Pipeline"` badge (blue styling).
5. In the Overview panel, verify the archetype selector displays `"Linear Pipeline"`.
6. Add two sequential agent nodes and connect an edge between them.
7. Click **Save** (or press `Ctrl+S`).
8. Refresh the browser page or navigate to `/org?workflowId=<newId>`.
9. **Expected Outcome**:
   - The workflow reloads with the `"Linear Pipeline"` badge.
   - Nodes and edges render cleanly.
   - Persisted API payload contains `archetype: "linear-pipeline"` and `archetypeConfig.category: "linear-pipeline"`.

---

### Scenario 2: Create and Configure a Hierarchical Supervisor
1. Click **New workflow**.
2. In the creation dialog:
   - Enter name: `"Bug Triaging & Remediation"`.
   - Select archetype: **Hierarchical Supervisor**.
   - Click **Create**.
3. Verify the editor loads with the `"Hierarchical Supervisor"` badge (purple styling).
4. Inspect the Overview panel:
   - Notice the **Supervisor Hub** selector displays *"No agent nodes on canvas"*.
   - The **Run** button on the toolbar is disabled, and validation flags `MISSING_SUPERVISOR_HUB`.
5. Drag an Agent node from the palette onto the canvas and name it `"Triage Lead"`.
6. In the Overview panel:
   - In **Supervisor Hub**, select `"Triage Lead"`.
7. Add a Condition node with branches `["implement_fix", "loop_limit_exceeded"]`.
8. In the **Recursion Guards** section of the Overview panel:
   - Click **Add Guard**.
   - Set Route: `"qa_verify->implement_fix"`.
   - Set Max Iterations: `3`.
   - Set Fallback Exit Branch: `"loop_limit_exceeded"`.
9. Wire the `"loop_limit_exceeded"` edge to an Output node.
10. Click **Save**.
11. **Expected Outcome**:
    - Validation passes with zero blocking errors.
    - The **Run** button becomes enabled.
    - Persisted payload includes `supervisorHubNodeId`, `maxExecutionSteps: 1000`, and `recursionGuards`.

---

### Scenario 3: Non-Destructive Conversion from Linear Pipeline to Supervisor
1. Open an existing Linear Pipeline workflow (e.g. 4 nodes in a straight line).
2. With no node or edge selected, inspect the Overview panel.
3. In the **Archetype** dropdown, select **Hierarchical Supervisor**.
4. **Expected Outcome**:
   - The header badge immediately updates to `"Hierarchical Supervisor"`.
   - The workflow status displays `Unsaved`.
   - All 4 nodes and existing edges are completely preserved.
   - The Supervisor configuration section appears in the Overview panel, highlighting missing hub and condition requirements.
5. Press `Ctrl+Z` (Undo).
6. **Expected Outcome**:
   - The archetype reverts to `"Linear Pipeline"`.
   - The supervisor configuration panel disappears.

---

### Scenario 4: Conversion to Linear Pipeline with Cycle Detection
1. Open a valid Hierarchical Supervisor workflow that contains feedback cycles.
2. In the Overview panel, change the archetype to **Linear Pipeline**.
3. **Expected Outcome**:
   - The system displays a warning and highlights all participating cycle nodes on canvas.
   - Localized error badges display `LINEAR_PIPELINE_CYCLE_FORBIDDEN` on each cyclic node.
   - The **Run** button is disabled.
   - Attempting to save displays an actionable server validation error.
   - Supervisor settings are retained in a dormant state.
4. Press `Ctrl+Z` (Undo) or re-select **Hierarchical Supervisor**.
5. **Expected Outcome**:
   - Error disappears, the supervisor hub and guard settings are restored, and the workflow returns to valid runnable state.

---

### Scenario 5: Reactive Handling of Hub Agent Deletion
1. Open a configured Hierarchical Supervisor where Agent `"lead-agent"` is the supervisor hub.
2. Select `"lead-agent"` on canvas and press `Delete` (or click trash).
3. **Expected Outcome**:
   - The node is removed from canvas.
   - The Overview panel's Supervisor Hub selector displays an error border: *"Selected hub node lead-agent missing from canvas"*.
   - Validation surfaces `INVALID_SUPERVISOR_HUB`.
   - The **Run** button is disabled.
4. Press `Ctrl+Z` (Undo).
5. **Expected Outcome**:
   - The hub node is restored, and the validation error clears automatically.

---

### Scenario 6: Legacy Workflow Compatibility & Promotion
1. Open legacy workflow `wf-mw08286f-97zear` at `/o/pga/org` (persisted with neither `archetype` nor `archetypeConfig`).
2. **Expected Outcome**:
   - WorkflowSwitcher displays label `trigger on Azure DevOps bug submission [Linear Pipeline]`.
   - The header displays `"Linear Pipeline"` (or `"Linear Pipeline (Legacy)"`).
   - If the legacy graph contains cycles, it is NOT blocked by `LINEAR_PIPELINE_CYCLE_FORBIDDEN`, preserving existing behavior.
3. In the Overview panel, explicitly select `"Linear Pipeline"` and save.
4. **Expected Outcome**:
   - The definition is promoted to an explicit archetype contract (`archetype: "linear-pipeline"`).
   - If cycles are present, `LINEAR_PIPELINE_CYCLE_FORBIDDEN` now blocks save until cycles are resolved.

---

### Scenario 7: Unsaved Changes Navigation Protection & Save Failures
1. Change the archetype on any workflow without saving.
2. Attempt to select another workflow in the `WorkflowSwitcher` dropdown.
3. **Expected Outcome**:
   - Browser confirmation dialog prompts: *"Discard unsaved workflow changes?"*.
   - Clicking **Cancel** keeps the current workflow open with pending archetype edits intact.
4. Simulate a save failure (e.g. disconnect network or trigger 400 validation error).
5. **Expected Outcome**:
   - A visible red error banner displays the failure reason.
   - The editor does not reset or discard the draft; `isDirty` remains true.
