"use client";

import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isWorkflowArchetypeValid, resolveWorkflowArchetype, type AgentRecord, type ToolRecord, type WorkflowArchetypeCategory, type WorkflowDefinition } from "@multi-agent/types";
import { workflowService } from "@/services/workflowService";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { Button } from "@/components/ui/button";
import { deleteWorkflowConfirmMessage } from "@/lib/workflow/deleteConfirmMessage";
import { CreateWorkflowDialog, type CreateWorkflowDialogSubmitPayload } from "@/components/workflow/CreateWorkflowDialog";

export type WorkspacePackage = {
  version?: number;
  workflows?: WorkflowDefinition[];
  agents?: AgentRecord[];
  tools?: ToolRecord[];
};

export function formatArchetypeLabel(archetype?: string): string {
  return archetype === "hierarchical-supervisor" ? "Hierarchical Supervisor" : "Linear Pipeline";
}

/** Reject workspace packages whose archetype fields violate the archetype contract. */
export function assertWorkspaceArchetypes(workspace: WorkspacePackage): void {
  for (const workflow of workspace.workflows ?? []) {
    const message = archetypeImportError(workflow);
    if (message) throw new Error(message);
  }
}

export function archetypeImportError(workflow: WorkflowDefinition): string | null {
  const archetype = workflow.archetype as string | undefined;
  const category = workflow.archetypeConfig?.category as string | undefined;
  if (archetype !== undefined && !isWorkflowArchetypeValid(archetype)) {
    return `Unrecognized workflow archetype "${archetype}".`;
  }
  if (category !== undefined && !isWorkflowArchetypeValid(category)) {
    return `Unrecognized archetype category "${category}".`;
  }
  if (archetype !== undefined && category !== undefined && archetype !== category) {
    return "Workflow archetype must match archetypeConfig.category";
  }
  const steps = workflow.archetypeConfig?.maxExecutionSteps;
  if (steps !== undefined && (!Number.isInteger(steps) || steps < 1 || steps > 5000)) {
    return "maxExecutionSteps must be an integer between 1 and 5000.";
  }
  for (const guard of workflow.archetypeConfig?.recursionGuards ?? []) {
    if (!guard.routeKey?.trim() || !guard.fallbackBranch?.trim()) {
      return "Recursion guard is missing a route or fallback branch.";
    }
    if (!Number.isInteger(guard.maxIterations) || guard.maxIterations < 1 || guard.maxIterations > 10) {
      return "Recursion guard maxIterations must be an integer between 1 and 10.";
    }
  }
  return null;
}

export function WorkflowSwitcher() {
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const orgUrl = useOrgPath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const definition = useWorkflowStore((state) => state.definition);
  const dirty = useWorkflowStore((state) => state.isDirty);
  const saveState = useWorkflowStore((state) => state.saveState);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const workflows = useQuery({
    queryKey: ["org", orgId, "workflows", definition.id, saveState],
    queryFn: () => workflowService.listWorkflows(),
  });

  const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");

  const currentArchetype = resolveWorkflowArchetype(definition);
  const isSupervisor = currentArchetype === "hierarchical-supervisor";

  async function importPackage(workspace: WorkspacePackage) {
    if (!Array.isArray(workspace.workflows) || !Array.isArray(workspace.agents) || !Array.isArray(workspace.tools)) {
      throw new Error("Workspace package must include workflows, agents, and tools arrays.");
    }
    assertWorkspaceArchetypes(workspace);
    await workflowService.importWorkspace(workspace);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["org", orgId, "workflows"] }),
      queryClient.invalidateQueries({ queryKey: ["org", orgId, "agents"] }),
      queryClient.invalidateQueries({ queryKey: ["org", orgId, "tools"] }),
    ]);
    const workflowId = workspace.workflows[0]?.id;
    if (workflowId) router.push(orgUrl(`/org?workflowId=${encodeURIComponent(workflowId)}`));
  }

  async function deleteCurrentWorkflow() {
    if (!window.confirm(deleteWorkflowConfirmMessage(definition.name, dirty))) return;
    const deletedId = definition.id;
    setBusy(true);
    setError("");
    try {
      await workflowService.deleteWorkflow(deletedId);
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "workflows"] });
      const remaining = (await workflowService.listWorkflows()).filter((item) => item.id !== deletedId);
      if (remaining[0]) {
        router.push(orgUrl(`/org?workflowId=${encodeURIComponent(remaining[0].id)}`));
      } else {
        const created = await workflowService.createWorkflow();
        router.push(orgUrl(`/org?workflowId=${encodeURIComponent(created.id)}`));
      }
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
      <label className="flex items-center gap-2">
        <span>Workflow</span>
        <select
          aria-label="Saved workflow"
          className="max-w-72 rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-100"
          value={definition.id}
          disabled={busy}
          onChange={(event) => {
            const nextId = event.target.value;
            if (nextId === definition.id) return;
            if (canLeave()) {
              router.push(orgUrl(`/org?workflowId=${encodeURIComponent(nextId)}`));
            }
          }}
        >
          {!workflows.data?.some((item) => item.id === definition.id) && (
            <option value={definition.id}>
              {definition.name} [{formatArchetypeLabel(currentArchetype)}]
            </option>
          )}
          {workflows.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} [{formatArchetypeLabel(resolveWorkflowArchetype(item))}]
            </option>
          ))}
        </select>
      </label>

      {/* Archetype Badge */}
      <span
        data-testid="workflow-archetype-badge"
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
          isSupervisor
            ? "border border-purple-500/40 bg-purple-950/60 text-purple-300"
            : "border border-blue-500/40 bg-blue-950/60 text-blue-300"
        }`}
      >
        {formatArchetypeLabel(currentArchetype)}
      </span>

      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          if (!canLeave()) return;
          setCreateOpen(true);
        }}
      >
        New workflow
      </Button>
      <CreateWorkflowDialog
        isOpen={createOpen}
        isSubmitting={busy}
        onClose={() => { if (!busy) setCreateOpen(false); }}
        onSubmit={async (payload: CreateWorkflowDialogSubmitPayload) => {
          setBusy(true);
          setError("");
          try {
            const created = await workflowService.createWorkflow(payload.name, payload.archetype as WorkflowArchetypeCategory);
            setCreateOpen(false);
            router.push(orgUrl(`/org?workflowId=${encodeURIComponent(created.id)}`));
            setBusy(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setBusy(false);
          }
        }}
      />

      <Button variant="destructive" disabled={busy} onClick={() => { void deleteCurrentWorkflow(); }}>
        Delete
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || !canLeave()) return;
          setBusy(true);
          setError("");
          try {
            await importPackage(JSON.parse(await file.text()) as WorkspacePackage);
            setBusy(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setBusy(false);
          }
        }}
      />

      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          if (!canLeave()) return;
          fileInputRef.current?.click();
        }}
      >
        Import package
      </Button>

      <Button variant="ghost" onClick={() => { if (canLeave()) router.push(orgUrl("/org/agents")); }}>
        Agent registry
      </Button>
      <Button variant="ghost" onClick={() => { if (canLeave()) router.push(orgUrl("/org/tools")); }}>
        Tool registry
      </Button>
      <Button variant="ghost" onClick={() => { if (canLeave()) router.push(orgUrl("/org/memory")); }}>
        Memory explorer
      </Button>
      <Button variant="ghost" onClick={() => { if (canLeave()) router.push(orgUrl("/runs")); }}>
        Run history
      </Button>

      {(error || workflows.error) && (
        <p role="alert" className="text-red-300">
          {error || workflows.error?.message}
        </p>
      )}
    </div>
  );
}
