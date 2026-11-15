"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { modelSettingsSchema, type AgentBackend, type AgentExecutionPolicy } from "@multi-agent/types";
import { BACKEND_PROVIDERS, emptyBackend } from "@/lib/agentConfiguration";
import { Button } from "@/components/ui/button";
import { Field, fieldClass, Section } from "./AgentFields";

export function AgentBackendPanel({
  backend,
  onChange,
}: {
  backend: AgentBackend;
  onChange: (backend: AgentBackend) => void;
}) {
  return (
    <Section
      title="Execution backend"
      description="Runtime adapter, model parameters, and transport configuration. Authentication stays server-owned."
    >
      <Field label="Backend type">
        <select
          className={fieldClass}
          value={backend.type}
          onChange={(event) => {
            const type = event.target.value as AgentBackend["type"];
            if (
              type !== backend.type &&
              window.confirm(
                "Changing backend type removes the current backend-specific configuration. Execution permissions will stay unchanged. Continue?",
              )
            ) {
              onChange(emptyBackend(type));
            }
          }}
        >
          <option value="api">API</option>
          <option value="cli">CLI</option>
          <option value="local">Local</option>
          <option value="process">Process</option>
          <option value="webhook">Webhook</option>
        </select>
      </Field>

      {(backend.type === "api" || backend.type === "cli" || backend.type === "local") && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Provider">
            <input
              className={fieldClass}
              list="agent-backend-providers"
              value={backend.provider}
              onChange={(event) => onChange({ ...backend, provider: event.target.value })}
            />
          </Field>
          <datalist id="agent-backend-providers">
            {BACKEND_PROVIDERS[backend.type].map((provider: string) => (
              <option key={provider} value={provider} />
            ))}
          </datalist>
          <Field label={`Model${backend.type === "cli" ? " (optional)" : ""}`}>
            <input
              className={fieldClass}
              value={backend.model ?? ""}
              onChange={(event) => onChange({ ...backend, model: event.target.value })}
            />
          </Field>
        </div>
      )}

      {backend.type === "process" && (
        <div className="space-y-4">
          <Field label="Command">
            <input
              className={fieldClass}
              placeholder="Allowlisted command or binary name (e.g. my-script)"
              value={backend.command}
              onChange={(event) => onChange({ ...backend, command: event.target.value })}
            />
          </Field>
          <Field label="Arguments (one argument per line)">
            <textarea
              className={`${fieldClass} font-mono`}
              rows={4}
              value={(backend.args ?? []).join("\n")}
              onChange={(event) =>
                onChange({ ...backend, args: event.target.value.split("\n").filter(Boolean) })
              }
            />
          </Field>
          <Field label="Workspace root (optional)">
            <input
              className={`${fieldClass} font-mono`}
              placeholder="Absolute workspace directory path"
              value={backend.workspaceRoot ?? ""}
              onChange={(event) =>
                onChange({ ...backend, workspaceRoot: event.target.value || undefined })
              }
            />
          </Field>
          <p className="text-xs text-zinc-400">
            Process commands must be approved by server allowlists. Arbitrary commands outside allowlists are rejected.
          </p>
        </div>
      )}

      {backend.type === "webhook" && (
        <div className="space-y-4">
          <Field label="Destination URL">
            <input
              className={`${fieldClass} font-mono`}
              type="url"
              placeholder="https://api.example.com/agent"
              value={backend.url}
              onChange={(event) => onChange({ ...backend, url: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Method">
              <select
                className={fieldClass}
                value={backend.method ?? "POST"}
                onChange={(event) =>
                  onChange({ ...backend, method: event.target.value as "POST" | "PUT" })
                }
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
              </select>
            </Field>
            <Field label="Credential alias (optional)">
              <input
                className={fieldClass}
                placeholder="Credential broker alias"
                value={backend.credentialAlias ?? ""}
                onChange={(event) =>
                  onChange({ ...backend, credentialAlias: event.target.value || undefined })
                }
              />
            </Field>
          </div>
          <p className="text-xs text-zinc-400">
            Webhook destinations are protected by server anti-SSRF allowlists. Secrets belong in the credential broker, never in URL parameters.
          </p>
        </div>
      )}

      {backend.type === "cli" && (
        <div className="space-y-4">
          <Field label="Executable (optional)">
            <input
              className={`${fieldClass} font-mono`}
              placeholder="Provider default: codex, claude, agent, or agy"
              value={backend.executable ?? ""}
              onChange={(event) =>
                onChange({ ...backend, executable: event.target.value || undefined })
              }
            />
          </Field>
          <Field label="Arguments (one argument per line)">
            <textarea
              className={`${fieldClass} font-mono`}
              rows={5}
              value={(backend.args ?? []).join("\n")}
              onChange={(event) => onChange({ ...backend, args: event.target.value.split("\n") })}
            />
          </Field>
          <p className="text-xs text-zinc-400">
            Leave executable blank to use the provider default (<code className="font-mono">codex</code>, <code className="font-mono">claude</code>, <code className="font-mono">agent</code> for cursor, or <code className="font-mono">agy</code>). Leave arguments blank for non-interactive mode.
          </p>
        </div>
      )}

      {backend.type === "local" && (
        <Field label="Base URL (optional)">
          <input
            className={`${fieldClass} font-mono`}
            type="url"
            placeholder={
              backend.provider === "lmstudio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:11434"
            }
            value={backend.baseUrl ?? ""}
            onChange={(event) =>
              onChange({ ...backend, baseUrl: event.target.value || undefined })
            }
          />
        </Field>
      )}

      {(backend.type === "api" || backend.type === "local") && (
        <div className="space-y-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-300">Model sampling &amp; limits</span>
            {Object.keys(backend.settings ?? {}).length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ ...backend, settings: {} })}
                className="h-7 gap-1.5 text-xs"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset model settings
              </Button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {modelSettingsSchema(backend).map((field) => (
              <Field key={field.key} label={field.label}>
                <input
                  type="number"
                  className={fieldClass}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  placeholder="Provider default"
                  value={backend.settings?.[field.key] ?? ""}
                  onChange={(event) => {
                    const settings = { ...backend.settings };
                    if (event.target.value === "") delete settings[field.key];
                    else settings[field.key] = Number(event.target.value);
                    onChange({ ...backend, settings });
                  }}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-zinc-400">
            Blank values use provider defaults. Temperature, Top P, and output limits are sent to supported runtimes.
          </p>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Authentication is managed on the execution server. Do not enter credentials here.
      </p>
    </Section>
  );
}

export function ExecutionPolicyPanel({
  policy = {},
  onChange,
}: {
  policy?: AgentExecutionPolicy;
  onChange: (policy: AgentExecutionPolicy) => void;
}) {
  const update = (patch: Partial<AgentExecutionPolicy>) => onChange({ ...policy, ...patch });

  return (
    <Section
      title="Execution policy"
      description="Filesystem, shell, network, and workspace boundary constraints enforced alongside server allowlists."
    >
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 [html[data-appearance='light']_&]:text-amber-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          CLI execution is checked against both this policy and server-owned executable/workspace allowlists. These checks are guardrails, not an operating-system sandbox.
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Filesystem">
          <select
            className={fieldClass}
            value={policy.filesystem ?? ""}
            onChange={(event) => {
              const filesystem = event.target.value as AgentExecutionPolicy["filesystem"];
              if (
                filesystem !== "read-write" ||
                window.confirm("Read/write access allows the runtime to change files. Enable it?")
              ) {
                update({ filesystem: filesystem || undefined });
              }
            }}
          >
            <option value="">Not specified</option>
            <option value="none">None</option>
            <option value="read">Read</option>
            <option value="read-write">Read/write</option>
          </select>
        </Field>
        <Field label="Shell">
          <select
            className={fieldClass}
            value={policy.shell ?? ""}
            onChange={(event) => {
              const shell = event.target.value as AgentExecutionPolicy["shell"];
              if (
                shell !== "full" ||
                window.confirm("Full shell access permits unrestricted commands. Enable it?")
              ) {
                update({ shell: shell || undefined });
              }
            }}
          >
            <option value="">Not specified</option>
            <option value="disabled">Disabled</option>
            <option value="restricted">Restricted</option>
            <option value="full">Full</option>
          </select>
        </Field>
        <Field label="Network">
          <select
            className={fieldClass}
            value={policy.network === undefined ? "" : String(policy.network)}
            onChange={(event) =>
              update({
                network: event.target.value === "" ? undefined : event.target.value === "true",
              })
            }
          >
            <option value="">Not specified</option>
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </Field>
        <Field label="Workspace root">
          <input
            className={`${fieldClass} font-mono`}
            value={policy.workspaceRoot ?? ""}
            onChange={(event) => update({ workspaceRoot: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Allowed commands (one per line)">
        <textarea
          className={`${fieldClass} font-mono`}
          rows={4}
          value={(policy.allowedCommands ?? []).join("\n")}
          onChange={(event) =>
            update({ allowedCommands: event.target.value ? event.target.value.split("\n") : [] })
          }
        />
      </Field>
    </Section>
  );
}
