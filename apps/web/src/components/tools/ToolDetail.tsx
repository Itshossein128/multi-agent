"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { assertNoCredentials, TOOL_CATEGORIES, TOOL_IMPACTS, validateTool, type ToolRecord } from "@multi-agent/types";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";
import { useToolDetail } from "@/hooks/useToolDetail";
import { Field, fieldClass, Section } from "@/components/agents/AgentFields";
import { ToolAssignedAgents, ToolWorkflowUsage } from "./ToolResources";
import { ToolTestPanel } from "./ToolTestPanel";

const sections = ["Overview", "Configuration", "Agents", "Workflows", "Test"] as const;

export function ToolDetail({ toolId }: { toolId: string }) {
  const router = useRouter();
  const detail = useToolDetail(toolId);
  const [draft, setDraft] = useState<ToolRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<typeof sections[number]>("Overview");
  const [metadata, setMetadata] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const tool = draft ?? detail.tool.data;
  const dirty = Boolean(draft && (JSON.stringify(draft) !== JSON.stringify(detail.tool.data) || metadata !== JSON.stringify(detail.tool.data?.metadata, null, 2)));
  const busy = detail.save.isPending || detail.remove.isPending;

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => { if (errors.length) errorRef.current?.focus(); }, [errors]);

  const navigate = (url: string) => { if (!dirty || window.confirm("Discard unsaved tool changes?")) router.push(url); };
  const update = (patch: Partial<ToolRecord>) => {
    try { assertNoCredentials(patch); if (draft) setDraft({ ...draft, ...patch }); setNotice(""); }
    catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
  };
  const beginEdit = () => {
    if (!detail.tool.data) return;
    setDraft(structuredClone(detail.tool.data)); setMetadata(JSON.stringify(detail.tool.data.metadata, null, 2));
    setEditing(true); setErrors([]); setNotice("");
  };
  const save = async () => {
    if (!draft) return;
    let parsed: unknown;
    try { parsed = JSON.parse(metadata); } catch { setErrors(["Metadata must be a valid JSON object."]); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { setErrors(["Metadata must be a JSON object."]); return; }
    const candidate = { ...draft, metadata: parsed as ToolRecord["metadata"] };
    const validation = validateTool(candidate);
    if (validation.length) { setErrors(validation); return; }
    try {
      await detail.save.mutateAsync(candidate); setDraft(null); setEditing(false); setErrors([]); setNotice("Tool saved.");
    } catch (error) { setErrors([error instanceof Error ? error.message : "Unable to save tool."]); }
  };

  return <main className="min-h-screen bg-zinc-950 text-zinc-100">
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-8">
      <Button variant="ghost" onClick={() => navigate("/org/tools")}>Tool registry</Button>
      <Button variant="ghost" onClick={() => navigate("/org")}>← Back to Graph Editor</Button>
      {detail.tool.isPending && <p role="status">Loading tool…</p>}
      {detail.tool.isError && <Section title="Could not load tool"><p role="alert" className="text-red-300">{detail.tool.error.message}</p><Button onClick={() => void detail.tool.refetch()}>Retry</Button></Section>}
      {!detail.tool.isPending && !detail.tool.isError && !tool && <Section title="Tool not found"><p className="text-zinc-400">No tool with ID {toolId} exists in this browser’s Studio storage.</p></Section>}
      {tool && <>
        <header className="space-y-4 border-b border-zinc-800 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2"><p className="text-xs uppercase tracking-widest text-amber-300">Tool control</p><h1 className="break-words text-2xl font-semibold">{tool.name}</h1><p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-300">{tool.description || "No description yet."}</p><p className="break-all font-mono text-xs text-zinc-400">{tool.id}</p></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || dirty} onClick={async () => {
                try { const copy = await workflowService.duplicateTool(toolId); router.push(`/org/tools/${copy.id}`); }
                catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
              }}>Duplicate</Button>
              <Button variant="outline" onClick={() => setSection("Test")}>Test tool</Button>
              {!editing ? <Button onClick={beginEdit} disabled={busy}>Edit tool</Button> : <><Button disabled={busy || !dirty} onClick={() => void save()}>{detail.save.isPending ? "Saving…" : "Save"}</Button><Button variant="outline" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard unsaved tool changes?")) { setDraft(null); setEditing(false); setErrors([]); } }}>Cancel editing</Button></>}
              <Button variant="destructive" disabled={busy || detail.workflows.isPending || detail.workflows.isError} onClick={async () => {
                if (!window.confirm(`Delete tool “${tool.name}”?${dirty ? " Unsaved changes will be discarded." : ""}`)) return;
                try { await detail.remove.mutateAsync(); router.push("/org/tools"); } catch (error) { setErrors([error instanceof Error ? error.message : "Unable to delete tool."]); }
              }}>Delete</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-300"><span>Category: {tool.category}</span><span>Impact: {tool.impact}</span><span>{tool.enabled === false ? "Disabled" : "Enabled"}</span><span>Updated: {tool.updatedAt}</span></div>
        </header>
        {dirty && <p role="status" className="text-sm text-amber-200">Unsaved changes</p>}
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
        {!!errors.length && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-800 p-4 text-sm text-red-200"><p className="font-semibold">Please resolve:</p><ul className="ml-5 list-disc">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
        <nav aria-label="Tool sections" className="flex flex-wrap gap-2">{sections.map((name) => <Button key={name} variant={section === name ? "secondary" : "ghost"} aria-pressed={section === name} onClick={() => setSection(name)}>{name}</Button>)}</nav>
        {section === "Overview" && <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Tool overview"><dl className="grid grid-cols-2 gap-4 text-sm">
            {Object.entries({ Purpose: tool.description || "Not specified", Category: tool.category, Impact: tool.impact, Lifecycle: tool.enabled === false ? "Disabled" : "Enabled",
              "Configuration fields": Object.keys(tool.configuration).length,
              "Assigned agents": detail.agents.data ? detail.agents.data.filter((agent) => agent.tools.includes(toolId)).length : "Unavailable" }).map(([label, value]) => <div key={label}><dt className="text-zinc-400">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}
          </dl></Section>
          <Section title="Schemas"><p className="text-xs uppercase tracking-widest text-zinc-500">Input</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-zinc-300">{JSON.stringify(tool.inputSchema, null, 2)}</pre><p className="mt-3 text-xs uppercase tracking-widest text-zinc-500">Output</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-zinc-300">{JSON.stringify(tool.outputSchema, null, 2)}</pre></Section>
        </div>}
        {section === "Configuration" && <Section title="General configuration">
          {!editing && <p className="text-sm text-zinc-400">Choose Edit tool to change configuration.</p>}
          <fieldset disabled={!editing || busy} className="space-y-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tool.enabled !== false} onChange={(event) => update({ enabled: event.target.checked })} />Enabled</label>
            <Field label="Name"><input className={fieldClass} value={tool.name} onChange={(event) => update({ name: event.target.value })} /></Field>
            <Field label="Category"><select className={fieldClass} value={tool.category} onChange={(event) => update({ category: event.target.value as ToolRecord["category"] })}>{TOOL_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
            <Field label="Impact / permission level"><select className={fieldClass} value={tool.impact} onChange={(event) => update({ impact: event.target.value as ToolRecord["impact"] })}>{TOOL_IMPACTS.map((impact) => <option key={impact} value={impact}>{impact}</option>)}</select></Field>
            <Field label="Description / purpose"><textarea className={fieldClass} rows={3} value={tool.description} onChange={(event) => update({ description: event.target.value })} /></Field>
            <Field label="Configuration (JSON, no credentials)"><textarea className={`${fieldClass} font-mono`} rows={8} value={JSON.stringify(tool.configuration, null, 2)} onChange={(event) => {
              try { const parsed = JSON.parse(event.target.value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) update({ configuration: parsed }); } catch { /* keep prior valid state until parseable */ }
            }} /></Field>
            <Field label="Metadata (JSON, no credentials)"><textarea className={`${fieldClass} font-mono`} rows={8} value={editing ? metadata : JSON.stringify(tool.metadata, null, 2)} onChange={(event) => setMetadata(event.target.value)} /></Field>
          </fieldset>
        </Section>}
        {section === "Test" && <ToolTestPanel tool={detail.tool.data ?? tool} dirty={dirty} />}
        {(section === "Agents" || section === "Workflows") && (detail.agents.isPending || detail.workflows.isPending) && <p role="status">Loading usage data…</p>}
        {section === "Agents" && detail.agents.data && <ToolAssignedAgents toolId={toolId} agents={detail.agents.data} />}
        {section === "Workflows" && detail.workflows.data && <ToolWorkflowUsage toolId={toolId} workflows={detail.workflows.data} navigate={navigate} />}
      </>}
    </div>
  </main>;
}
