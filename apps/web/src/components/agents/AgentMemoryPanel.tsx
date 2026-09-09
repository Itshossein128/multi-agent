"use client";
import type { AgentMemoryConfig, LongTermMemoryConfig, MemoryKind, MemoryNamespace } from "@multi-agent/types";
import { Field, fieldClass, Section } from "./AgentFields";

export function AgentMemoryPanel({ memory, agentId, workflows = [], onChange }: {
  memory?: AgentMemoryConfig; agentId: string;
  workflows?: { id: string; name: string }[];
  onChange: (value: AgentMemoryConfig) => void;
}) {
  const value: AgentMemoryConfig = memory ?? { enabled: false, type: "run", scope: "agent", mode: "read_write", maxEntries: 10 };
  const own: MemoryNamespace = { scope: "agent", id: agentId };
  const longTerm = value.longTerm ?? { enabled: false };
  const readable = longTerm.readableNamespaces ?? [own];
  const writable = longTerm.writableNamespace ?? own;
  const update = (patch: Partial<AgentMemoryConfig>) => onChange({ ...value, ...patch });
  const updateLongTerm = (patch: Partial<LongTermMemoryConfig>) => update({ longTerm: { ...longTerm, ...patch } });
  const setRetrieval = (patch: NonNullable<LongTermMemoryConfig["retrieval"]>) => updateLongTerm({ retrieval: { ...longTerm.retrieval, ...patch } });
  return <Section title="Agent memory">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={(event) => update({ enabled: event.target.checked })} />Enable memory</label>
    <fieldset disabled={!value.enabled} className="space-y-5 disabled:opacity-60">
      <legend className="font-medium">Short-term execution context</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.shortTerm?.enabled ?? true} onChange={(event) => update({ shortTerm: { ...value.shortTerm, enabled: event.target.checked } })} />Enable short-term memory</label>
      <p className="text-sm text-zinc-400">Bounded input/output history belongs to the current execution thread. Agent scope shares history between sequential instances; node scope isolates them. It is not automatically promoted to long-term memory.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Short-term scope"><select className={fieldClass} value={value.scope} onChange={(event) => update({ scope: event.target.value as AgentMemoryConfig["scope"] })}><option value="agent">Agent within run</option><option value="node">Node within run</option></select></Field>
        <Field label="Read/write mode"><select className={fieldClass} value={value.mode} onChange={(event) => update({ mode: event.target.value as AgentMemoryConfig["mode"] })}><option value="read_write">Read and write</option><option value="read">Read only</option><option value="write">Write only</option></select></Field>
        <Field label="Maximum history entries"><input type="number" min={1} max={100} step={1} className={fieldClass} value={value.maxEntries} onChange={(event) => update({ maxEntries: Number(event.target.value) })} /></Field>
        <Field label="Short-term context budget"><input type="number" min={64} max={8192} step={1} className={fieldClass} value={value.shortTerm?.maxTokens ?? 4096} onChange={(event) => update({ shortTerm: { enabled: value.shortTerm?.enabled ?? true, maxTokens: Number(event.target.value) } })} /></Field>
      </div>
      <div className="border-t border-zinc-800 pt-5">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={longTerm.enabled} onChange={(event) => updateLongTerm({ enabled: event.target.checked })} />Enable long-term memory</label>
        <p className="mt-2 text-sm text-zinc-400">Durable facts, useful experiences, and reusable procedures survive runs in backend storage. These settings request scopes; the server must separately authorize them. Memory-enabled execution requires authenticated access.</p>
      </div>
      <fieldset disabled={!longTerm.enabled} className="space-y-4 disabled:opacity-60">
        <legend className="text-sm font-medium">Long-term settings</legend>
        <div className="flex flex-wrap gap-5">{(["semantic", "episodic", "procedural"] as MemoryKind[]).map((kind) => <label key={kind} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(longTerm.kinds ?? ["semantic"]).includes(kind)} onChange={(event) => {
          const kinds = longTerm.kinds ?? ["semantic"];
          updateLongTerm({ kinds: event.target.checked ? [...kinds, kind] : kinds.filter((item) => item !== kind) });
        }} />{kind}</label>)}</div>
        <Field label="Write scope"><select className={fieldClass} value={`${writable.scope}:${writable.id}`} onChange={(event) => {
          const separator = event.target.value.indexOf(":");
          updateLongTerm({ writableNamespace: { scope: event.target.value.slice(0, separator) as MemoryNamespace["scope"], id: event.target.value.slice(separator + 1) } });
        }}>
          <option value={`agent:${agentId}`}>This agent (private)</option>
          {workflows.map((workflow) => <option key={workflow.id} value={`workflow:${workflow.id}`}>{workflow.name} (workflow)</option>)}
          {writable.scope !== "agent" && !workflows.some((workflow) => writable.scope === "workflow" && workflow.id === writable.id) && <option value={`${writable.scope}:${writable.id}`}>{writable.scope}/{writable.id} (configured)</option>}
        </select></Field>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm">Readable scopes</legend>
          {[{ ...own, label: "This agent (private)" }, ...workflows.map((workflow) => ({ scope: "workflow" as const, id: workflow.id, label: workflow.name }))].map((namespace) => <label key={`${namespace.scope}:${namespace.id}`} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={readable.some((item) => item.scope === namespace.scope && item.id === namespace.id)} onChange={(event) => updateLongTerm({ readableNamespaces: event.target.checked ? [...readable, { scope: namespace.scope, id: namespace.id }] : readable.filter((item) => item.scope !== namespace.scope || item.id !== namespace.id) })} />{namespace.label}</label>)}
          {readable.filter((item) => !(item.scope === "agent" && item.id === agentId) && !workflows.some((workflow) => item.scope === "workflow" && item.id === workflow.id)).map((item) => <p key={`${item.scope}:${item.id}`} className="break-all text-xs text-zinc-400">Configured scope: {item.scope}/{item.id}</p>)}
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Maximum retrieved memories"><input type="number" min={1} max={50} step={1} className={fieldClass} value={longTerm.retrieval?.maxMemories ?? 5} onChange={(event) => setRetrieval({ maxMemories: Number(event.target.value) })} /></Field>
          <Field label="Long-term context budget"><input type="number" min={64} max={8192} step={1} className={fieldClass} value={longTerm.retrieval?.maxTokens ?? 2048} onChange={(event) => setRetrieval({ maxTokens: Number(event.target.value) })} /></Field>
          <Field label="Minimum relevance score"><input type="number" min={0} max={1} step={0.05} className={fieldClass} value={longTerm.retrieval?.minScore ?? 0.2} onChange={(event) => setRetrieval({ minScore: Number(event.target.value) })} /></Field>
          <Field label="Memory write timing"><select className={fieldClass} value={longTerm.writeMode ?? "background"} onChange={(event) => updateLongTerm({ writeMode: event.target.value as LongTermMemoryConfig["writeMode"] })}><option value="background">After execution</option><option value="hot_path">Before execution completes</option></select></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={longTerm.required ?? false} onChange={(event) => updateLongTerm({ required: event.target.checked })} />Require memory availability (fail execution if unavailable)</label>
      </fieldset>
    </fieldset>
  </Section>;
}
