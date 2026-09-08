"use client";
import type { AgentMemoryConfig } from "@multi-agent/types";
import { Field, fieldClass, Section } from "./AgentFields";

export function AgentMemoryPanel({ memory, onChange }: { memory?: AgentMemoryConfig; onChange: (value: AgentMemoryConfig) => void }) {
  const value: AgentMemoryConfig = memory ?? { enabled: false, type: "run", scope: "agent", mode: "read_write", maxEntries: 10 };
  const update = (patch: Partial<AgentMemoryConfig>) => onChange({ ...value, ...patch });
  return <Section title="Agent memory">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={(event) => update({ enabled: event.target.checked })} />Enable run memory</label>
    <p className="text-sm text-zinc-400">Bounded input/output history lasts for one run. Agent scope shares history between this agent’s sequential node instances; node scope isolates each instance. Runs never share memory. Persistent memory belongs to the later memory phase.</p>
    <Field label="Memory scope"><select className={fieldClass} value={value.scope} onChange={(event) => update({ scope: event.target.value as AgentMemoryConfig["scope"] })}><option value="agent">Agent within run</option><option value="node">Node within run</option></select></Field>
    <Field label="Read/write mode"><select className={fieldClass} value={value.mode} onChange={(event) => update({ mode: event.target.value as AgentMemoryConfig["mode"] })}><option value="read_write">Read and write</option><option value="read">Read only</option><option value="write">Write only</option></select></Field>
    <Field label="Maximum history entries"><input type="number" min={1} max={100} step={1} className={fieldClass} value={value.maxEntries} onChange={(event) => update({ maxEntries: Number(event.target.value) })} /></Field>
  </Section>;
}
