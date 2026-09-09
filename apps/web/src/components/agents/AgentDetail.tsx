"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { assertNoCredentials, type AgentRecord } from "@multi-agent/types";
import { workflowService } from "@/services/workflowService";
import { AgentMemoryPanel } from "./AgentMemoryPanel";
import { AgentTestPanel } from "./AgentTestPanel";
import { Button } from "@/components/ui/button";
import { useAgentDetail, useAgentRunEvents } from "@/hooks/useAgentDetail";
import { runDuration, validateAgentConfiguration } from "@/lib/agentConfiguration";
import { AgentBackendPanel, ExecutionPolicyPanel } from "./AgentBackendPanel";
import { AgentToolsPanel, AgentWorkflowUsage } from "./AgentResources";
import { AgentExecutionHistory } from "./AgentExecutionHistory";
import { Field, fieldClass, Section } from "./AgentFields";

const sections = ["Overview", "Configuration", "Backend", "Tools", "Memory", "Workflows", "Executions", "Test"] as const;

export function AgentDetail({ agentId }: { agentId: string }) {
  const router = useRouter();
  const detail = useAgentDetail(agentId);
  const latestRun = detail.runs.data?.[0];
  const latestEvents = useAgentRunEvents(agentId, latestRun?.id ?? null);
  const lastActivity = latestEvents.data?.filter((event) => event.type.startsWith("agent.") || event.type.startsWith("human_approval.")).at(-1);
  const runtimeStatus = lastActivity?.type === "agent.failed" ? "failed"
    : lastActivity?.type === "agent.completed" ? "idle"
    : lastActivity?.type === "human_approval.requested" && latestRun?.status === "waiting_for_human" ? "waiting"
    : lastActivity?.type === "agent.started" && latestRun?.status === "running" ? "running"
    : "unknown";
  const [draft, setDraft] = useState<AgentRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<typeof sections[number]>("Overview");
  const [metadata, setMetadata] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const agent = draft ?? detail.agent.data;
  const dirty = Boolean(draft && (JSON.stringify(draft) !== JSON.stringify(detail.agent.data) || metadata !== JSON.stringify(detail.agent.data?.metadata, null, 2)));
  const busy = detail.save.isPending || detail.remove.isPending;

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => { if (errors.length) errorRef.current?.focus(); }, [errors]);

  const navigate = (url: string) => { if (!dirty || window.confirm("Discard unsaved agent changes?")) router.push(url); };
  const update = (patch: Partial<AgentRecord>) => {
    try { assertNoCredentials(patch); if (draft) setDraft({ ...draft, ...patch }); setNotice(""); }
    catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
  };
  const beginEdit = () => {
    if (!detail.agent.data) return;
    setDraft(structuredClone(detail.agent.data)); setMetadata(JSON.stringify(detail.agent.data.metadata, null, 2));
    setEditing(true); setErrors([]); setNotice("");
  };
  const save = async () => {
    if (!draft) return;
    let parsed: unknown;
    try { parsed = JSON.parse(metadata); } catch { setErrors(["Metadata must be a valid JSON object."]); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { setErrors(["Metadata must be a JSON object."]); return; }
    const candidate = { ...draft, metadata: parsed as AgentRecord["metadata"] };
    const validation = validateAgentConfiguration(candidate);
    if (validation.length) { setErrors(validation); return; }
    try {
      await detail.save.mutateAsync(candidate); setDraft(null); setEditing(false); setErrors([]); setNotice("Agent saved.");
    } catch (error) { setErrors([error instanceof Error ? error.message : "Unable to save agent."]); }
  };

  return <main className="min-h-screen bg-zinc-950 text-zinc-100">
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-8">
      <Button variant="ghost" onClick={() => navigate("/org/agents")}>Agent registry</Button>
      <Button variant="ghost" onClick={() => navigate("/org")}>← Back to Graph Editor</Button>
      {detail.agent.isPending && <p role="status">Loading agent…</p>}
      {detail.agent.isError && <Section title="Could not load agent"><p role="alert" className="text-red-300">{detail.agent.error.message}</p><Button onClick={() => void detail.agent.refetch()}>Retry</Button></Section>}
      {!detail.agent.isPending && !detail.agent.isError && !agent && <Section title="Agent not found"><p className="text-zinc-400">No agent with ID {agentId} exists in this browser’s Studio storage.</p></Section>}
      {agent && <>
        <header className="space-y-4 border-b border-zinc-800 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2"><p className="text-xs uppercase tracking-widest text-indigo-300">Agent control</p><h1 className="break-words text-2xl font-semibold">{agent.name}</h1><p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-300">{agent.description || "No description yet."}</p><p className="break-all font-mono text-xs text-zinc-400">{agent.id}</p></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || dirty} onClick={async () => {
                try { const copy = await workflowService.duplicateAgent(agentId); router.push(`/org/agents/${copy.id}`); }
                catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
              }}>Duplicate</Button>
              <Button variant="outline" onClick={() => setSection("Test")}>Test agent</Button>
              {!editing ? <Button onClick={beginEdit} disabled={busy}>Edit agent</Button> : <><Button disabled={busy || !dirty} onClick={() => void save()}>{detail.save.isPending ? "Saving…" : "Save"}</Button><Button variant="outline" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard unsaved agent changes?")) { setDraft(null); setEditing(false); setErrors([]); } }}>Cancel editing</Button></>}
              <Button variant="outline" disabled={busy} onClick={() => setSection("Workflows")}>Open in Graph</Button>
              <Button variant="destructive" disabled={busy || detail.workflows.isPending || detail.workflows.isError} onClick={async () => {
                if (!window.confirm(`Delete agent “${agent.name}”?${dirty ? " Unsaved changes will be discarded." : ""}`)) return;
                try { await detail.remove.mutateAsync(); router.push("/org"); } catch (error) { setErrors([error instanceof Error ? error.message : "Unable to delete agent."]); }
              }}>Delete</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-300"><span>Last observed agent status: {runtimeStatus}</span><span>Backend: {agent.backend.type} / {agent.backend.provider}</span><span>Model: {agent.backend.model || "Runtime default"}</span><span>Updated: {agent.updatedAt}</span><span>Last execution: {latestRun?.startedAt ?? (detail.runs.isError ? "Unavailable" : detail.runs.isPending ? "Loading…" : "None recorded")}</span></div>
        </header>
        {dirty && <p role="status" className="text-sm text-amber-200">Unsaved changes</p>}
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
        {!!errors.length && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-800 p-4 text-sm text-red-200"><p className="font-semibold">Please resolve:</p><ul className="ml-5 list-disc">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
        <nav aria-label="Agent sections" className="flex flex-wrap gap-2">{sections.map((name) => <Button key={name} variant={section === name ? "secondary" : "ghost"} aria-pressed={section === name} onClick={() => setSection(name)}>{name}</Button>)}</nav>
        {section === "Overview" && <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Agent overview"><dl className="grid grid-cols-2 gap-4 text-sm">
            {Object.entries({ Purpose: agent.description || "Not specified", Backend: `${agent.backend.type} / ${agent.backend.provider}`, Model: agent.backend.model || "Runtime default", "Assigned tools": agent.tools.length,
              "Saved workflows": detail.workflows.data ? detail.workflows.data.filter((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId)).length : "Unavailable",
              "Last run status": detail.runs.isError ? "Unavailable" : detail.runs.data?.[0]?.status ?? "No executions", "Last run duration": detail.runs.data?.[0] ? runDuration(detail.runs.data[0].startedAt, detail.runs.data[0].completedAt) : "Not available", Memory: agent.memory?.enabled ? `Run / ${agent.memory.scope} / ${agent.memory.mode}` : "Disabled", Lifecycle: agent.enabled === false ? "Disabled" : "Enabled" }).map(([label, value]) => <div key={label}><dt className="text-zinc-400">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}
          </dl></Section>
          <Section title="System prompt"><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm text-zinc-300">{agent.systemPrompt || "No system prompt configured."}</pre></Section>
          <Section title="Backend health"><p className="text-sm">Unknown</p><p className="text-sm text-zinc-400">Runtime diagnostics and authentication status are not exposed by the current server. Availability has not been checked.</p></Section>
        </div>}
        {section === "Configuration" && <Section title="General configuration">
          {!editing && <p className="text-sm text-zinc-400">Choose Edit agent to change configuration.</p>}
          <fieldset disabled={!editing || busy} className="space-y-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agent.enabled !== false} onChange={(event) => update({ enabled: event.target.checked })} />Enabled for execution</label>
            <Field label="Name"><input className={fieldClass} value={agent.name} onChange={(event) => update({ name: event.target.value })} /></Field>
            <Field label="Description / purpose"><textarea className={fieldClass} rows={3} value={agent.description} onChange={(event) => update({ description: event.target.value })} /></Field>
            <Field label="System prompt"><textarea className={`${fieldClass} min-h-80 font-mono`} rows={16} value={agent.systemPrompt} onChange={(event) => update({ systemPrompt: event.target.value })} /></Field>
            <Field label="Metadata (JSON, no credentials)"><textarea className={`${fieldClass} font-mono`} rows={8} value={editing ? metadata : JSON.stringify(agent.metadata, null, 2)} onChange={(event) => setMetadata(event.target.value)} /></Field>
          </fieldset>
        </Section>}
        {section === "Backend" && <fieldset disabled={!editing || busy} className="space-y-5"><AgentBackendPanel backend={agent.backend} onChange={(backend) => update({ backend })} /><ExecutionPolicyPanel policy={agent.executionPolicy} onChange={(executionPolicy) => update({ executionPolicy })} /></fieldset>}
        {section === "Test" && <AgentTestPanel agent={detail.agent.data ?? agent} dirty={dirty} />}
        {(section === "Tools" || section === "Workflows") && detail.workflows.isPending && <p role="status">Loading saved workflows…</p>}
        {(section === "Tools" || section === "Workflows") && detail.workflows.isError && <Section title="Workflow data unavailable"><p role="alert">{detail.workflows.error.message}</p><Button onClick={() => void detail.workflows.refetch()}>Retry</Button></Section>}
        {section === "Tools" && <AgentToolsPanel agent={agent} workflows={detail.workflows.data ?? []} editing={editing && !busy} onChange={(tools) => update({ tools })} />}
        {section === "Memory" && <fieldset disabled={!editing || busy}><AgentMemoryPanel agentId={agentId} workflows={detail.workflows.data ?? []} memory={agent.memory} onChange={(memory) => update({ memory })} /></fieldset>}
        {section === "Workflows" && detail.workflows.data && <AgentWorkflowUsage agentId={agentId} workflows={detail.workflows.data} navigate={navigate} />}
        {section === "Executions" && <>
          <Button variant="outline" disabled={detail.runs.isFetching} onClick={() => void detail.runs.refetch()}>Refresh runs</Button>
          {detail.runs.isPending && <p role="status">Loading executions…</p>}
          {detail.runs.isError && <p role="alert" className="text-sm text-red-300">Execution history unavailable: {detail.runs.error.message}. Check the execution server and retry.</p>}
          {detail.runs.data && <AgentExecutionHistory agentId={agentId} runs={detail.runs.data} navigate={navigate} />}
        </>}
      </>}
    </div>
  </main>;
}
