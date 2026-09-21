"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import { workflowService } from "@/services/workflowService";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { Button } from "@/components/ui/button";

type WorkspacePackage = {
  version?: number;
  workflows?: WorkflowDefinition[];
  agents?: AgentRecord[];
  tools?: ToolRecord[];
};

export function WorkflowSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const definition = useWorkflowStore((state) => state.definition);
  const dirty = useWorkflowStore((state) => state.isDirty);
  const saveState = useWorkflowStore((state) => state.saveState);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workflows = useQuery({ queryKey: ["workflows", definition.id, saveState], queryFn: () => workflowService.listWorkflows() });
  const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");

  async function importPackage(workspace: WorkspacePackage) {
    if (!Array.isArray(workspace.workflows) || !Array.isArray(workspace.agents) || !Array.isArray(workspace.tools)) {
      throw new Error("Workspace package must include workflows, agents, and tools arrays.");
    }
    await workflowService.importWorkspace(workspace);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workflows"] }),
      queryClient.invalidateQueries({ queryKey: ["agents"] }),
      queryClient.invalidateQueries({ queryKey: ["tools"] }),
    ]);
    const workflowId = workspace.workflows[0]?.id;
    if (workflowId) router.push(`/org?workflowId=${encodeURIComponent(workflowId)}`);
  }

  return <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
    <label className="flex items-center gap-2">Workflow<select aria-label="Saved workflow" className="max-w-64 rounded border border-zinc-700 bg-zinc-900 p-2" value={definition.id} disabled={busy} onChange={(event) => {
      if (canLeave()) router.push(`/org?workflowId=${encodeURIComponent(event.target.value)}`);
    }}>
      {!workflows.data?.some((item) => item.id === definition.id) && <option value={definition.id}>{definition.name}</option>}
      {workflows.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <Button variant="outline" disabled={busy} onClick={async () => {
      if (!canLeave()) return;
      const name = window.prompt("Workflow name", "Untitled Workflow");
      if (!name?.trim()) return;
      setBusy(true); setError("");
      try { const created = await workflowService.createWorkflow(name.trim()); router.push(`/org?workflowId=${encodeURIComponent(created.id)}`); setBusy(false); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
    }}>New workflow</Button>
    <input
      ref={fileInputRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !canLeave()) return;
        setBusy(true); setError("");
        try {
          await importPackage(JSON.parse(await file.text()) as WorkspacePackage);
          setBusy(false);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setBusy(false);
        }
      }}
    />
    <Button variant="outline" disabled={busy} onClick={() => {
      if (!canLeave()) return;
      fileInputRef.current?.click();
    }}>Import package</Button>
    <Button variant="ghost" onClick={() => { if (canLeave()) router.push("/org/agents"); }}>Agent registry</Button>
    <Button variant="ghost" onClick={() => { if (canLeave()) router.push("/org/tools"); }}>Tool registry</Button>
    <Button variant="ghost" onClick={() => { if (canLeave()) router.push("/org/memory"); }}>Memory explorer</Button>
    <Button variant="ghost" onClick={() => { if (canLeave()) router.push("/runs"); }}>Run history</Button>
    {(error || workflows.error) && <p role="alert" className="text-red-300">{error || workflows.error?.message}</p>}
  </div>;
}
