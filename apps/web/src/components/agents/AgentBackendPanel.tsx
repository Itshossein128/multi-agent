"use client";

import type { AgentBackend, AgentExecutionPolicy } from "@multi-agent/types";
import { BACKEND_PROVIDERS, emptyBackend } from "@/lib/agentConfiguration";
import { Field, fieldClass, Section } from "./AgentFields";

export function AgentBackendPanel({ backend, onChange }: { backend: AgentBackend; onChange: (backend: AgentBackend) => void }) {
  return <Section title="Execution backend">
    <Field label="Backend type"><select className={fieldClass} value={backend.type} onChange={(event) => {
      const type = event.target.value as AgentBackend["type"];
      if (type !== backend.type && window.confirm("Changing backend type removes the current backend-specific configuration. Execution permissions will stay unchanged. Continue?")) onChange(emptyBackend(type));
    }}><option value="api">API</option><option value="cli">CLI</option><option value="local">Local</option></select></Field>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Provider"><input className={fieldClass} list="agent-backend-providers" value={backend.provider} onChange={(event) => onChange({ ...backend, provider: event.target.value })} /></Field>
      <datalist id="agent-backend-providers">{BACKEND_PROVIDERS[backend.type].map((provider) => <option key={provider} value={provider} />)}</datalist>
      <Field label={`Model${backend.type === "cli" ? " (optional)" : ""}`}><input className={fieldClass} value={backend.model ?? ""} onChange={(event) => onChange({ ...backend, model: event.target.value })} /></Field>
    </div>
    {backend.type === "cli" && <>
      <Field label="Executable (optional)"><input className={fieldClass} value={backend.executable ?? ""} onChange={(event) => onChange({ ...backend, executable: event.target.value })} /></Field>
      <Field label="Arguments (one argument per line)"><textarea className={fieldClass} rows={5} value={(backend.args ?? []).join("\n")} onChange={(event) => onChange({ ...backend, args: event.target.value.split("\n") })} /></Field>
      <p className="text-sm text-zinc-400">Use Workspace root under Execution policy. Session mode is not represented in the current agent model.</p>
    </>}
    {backend.type === "local" && <Field label="Base URL (optional)"><input className={fieldClass} type="url" value={backend.baseUrl ?? ""} onChange={(event) => onChange({ ...backend, baseUrl: event.target.value })} /></Field>}
    <p className="text-sm text-zinc-400">Authentication is managed on the execution server. Do not enter credentials here.</p>
  </Section>;
}

export function ExecutionPolicyPanel({ policy = {}, onChange }: { policy?: AgentExecutionPolicy; onChange: (policy: AgentExecutionPolicy) => void }) {
  const update = (patch: Partial<AgentExecutionPolicy>) => onChange({ ...policy, ...patch });
  return <Section title="Execution policy">
    <p className="text-sm text-amber-200">These permissions primarily apply to CLI/local execution. The current runtime does not fully enforce this policy; settings do not provide a sandbox.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Filesystem"><select className={fieldClass} value={policy.filesystem ?? ""} onChange={(event) => {
        const filesystem = event.target.value as AgentExecutionPolicy["filesystem"];
        if (filesystem !== "read-write" || window.confirm("Read/write access allows the runtime to change files. Enable it?")) update({ filesystem: filesystem || undefined });
      }}><option value="">Not specified</option><option value="none">None</option><option value="read">Read</option><option value="read-write">Read/write</option></select></Field>
      <Field label="Shell"><select className={fieldClass} value={policy.shell ?? ""} onChange={(event) => {
        const shell = event.target.value as AgentExecutionPolicy["shell"];
        if (shell !== "full" || window.confirm("Full shell access permits unrestricted commands. Enable it?")) update({ shell: shell || undefined });
      }}><option value="">Not specified</option><option value="disabled">Disabled</option><option value="restricted">Restricted</option><option value="full">Full</option></select></Field>
      <Field label="Network"><select className={fieldClass} value={policy.network === undefined ? "" : String(policy.network)} onChange={(event) => update({ network: event.target.value === "" ? undefined : event.target.value === "true" })}><option value="">Not specified</option><option value="false">Disabled</option><option value="true">Enabled</option></select></Field>
      <Field label="Workspace root"><input className={fieldClass} value={policy.workspaceRoot ?? ""} onChange={(event) => update({ workspaceRoot: event.target.value })} /></Field>
    </div>
    <Field label="Allowed commands (one per line)"><textarea className={fieldClass} rows={4} value={(policy.allowedCommands ?? []).join("\n")} onChange={(event) => update({ allowedCommands: event.target.value ? event.target.value.split("\n") : [] })} /></Field>
  </Section>;
}
