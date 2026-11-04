"use client";

/**
 * Per-node-type configuration forms for the properties panel.
 * Each form owns exactly one node type's config editing.
 */

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  AgentNodeConfig,
  ApprovalNodeConfig,
  ConditionNodeConfig,
  InputNodeConfig,
  MemoryNodeConfig,
  NODE_CONTRACT_VERSION,
  NodeContract,
  OutputNodeConfig,
  ToolNodeConfig,
  ToolRecord,
  TOOL_CATEGORIES,
  WorkflowNode,
  agentBackendLabel,
  modelSettingsSchema,
} from "@/lib/workflow/types";
import type { AgentModelSettings } from "@multi-agent/types";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import { Field, JsonField, inputClass, labelClass } from "./fields";

function clampToolStepsInput(raw: string): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n || 5));
}

type ActiveToolsMode = "inherit" | "empty" | "subset";

function activeToolsMode(config: AgentNodeConfig): ActiveToolsMode {
  if (config.activeTools === undefined) return "inherit";
  if (config.activeTools.length === 0) return "empty";
  return "subset";
}

export function AgentForm({ node }: { node: WorkflowNode }) {
  const config = node.config as AgentNodeConfig;
  const agents = useWorkflowStore((s) => s.agents);
  const tools = useWorkflowStore((s) => s.tools);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const orgUrl = useOrgPath();
  const router = useRouter();

  const agent = agents.find((a) => a.id === config.agentId);
  const supportsModelOverride = agent?.backend.type === "api" || agent?.backend.type === "local";
  const supportsActiveTools = agent?.backend.type === "api";
  const schemaFields = agent && supportsModelOverride ? modelSettingsSchema(agent.backend) : [];
  const baseSettings =
    agent && (agent.backend.type === "api" || agent.backend.type === "local")
      ? agent.backend.settings ?? {}
      : {};
  const override = config.modelSettingsOverride ?? {};
  const toolsMode = activeToolsMode(config);

  const setModelOverride = (key: keyof AgentModelSettings, value: number | undefined) => {
    const next: Partial<AgentModelSettings> = { ...override };
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
    updateNodeConfig(node.id, {
      modelSettingsOverride: Object.keys(next).length ? next : undefined,
    });
  };

  const openRegistryEditor = () => {
    if (!agent) return;
    const ok = window.confirm(
      `Editing "${agent.name}" in the Agent Registry changes the shared base agent for every workflow step that uses it. Continue?`
    );
    if (!ok) return;
    router.push(orgUrl(`/org/agents/${encodeURIComponent(agent.id)}`));
  };

  return (
    <div className="space-y-3">
      <Field label="Base Agent">
        <select
          data-testid="base-agent-select"
          value={config.agentId ?? ""}
          onChange={(event) => {
            const nextId = event.target.value || null;
            // Preserve taskInstruction and overrides; incompatibilities surface in validation.
            updateNodeConfig(node.id, { agentId: nextId });
          }}
          className={inputClass}
        >
          <option value="">— not linked —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-zinc-600">
          Step settings below apply only to this node. Shared agent defaults live in the registry.
        </p>
      </Field>

      {agent && (
        <>
          <div
            data-testid="base-agent-summary"
            className="rounded border border-zinc-800 bg-zinc-950/50 p-2 space-y-1 text-[11px] text-zinc-400"
          >
            <div className="text-zinc-200 font-medium">{agent.name}</div>
            <div>{agentBackendLabel(agent.backend)}</div>
            <div className="line-clamp-3 whitespace-pre-wrap font-mono text-[10px] text-zinc-500">
              {agent.systemPrompt.trim() || "(no system prompt)"}
            </div>
            <div>
              Tools:{" "}
              {agent.tools.length
                ? agent.tools
                    .map((id) => tools.find((t) => t.id === id)?.name ?? id)
                    .join(", ")
                : "none"}
            </div>
          </div>

          <button
            type="button"
            data-testid="edit-agent-in-registry"
            className="w-full rounded border border-zinc-700 px-2 py-1.5 text-xs text-indigo-300 hover:bg-zinc-900"
            onClick={openRegistryEditor}
          >
            Edit Agent in Registry
          </button>

          <Field label="Step Instructions">
            <textarea
              data-testid="step-task-instruction"
              value={config.taskInstruction ?? ""}
              onChange={(event) =>
                updateNodeConfig(node.id, {
                  taskInstruction: event.target.value || undefined,
                })
              }
              rows={4}
              placeholder="Task guidance for this step only (does not change the base system prompt)…"
              className={cn(inputClass, "font-mono text-[11px]")}
            />
          </Field>

          {supportsModelOverride && schemaFields.length > 0 && (
            <div className="space-y-2" data-testid="step-model-settings">
              <p className={labelClass}>Model settings (step overrides)</p>
              {schemaFields.map((field) => {
                const overridden = Object.prototype.hasOwnProperty.call(override, field.key);
                const inherited = baseSettings[field.key];
                const effective = overridden
                  ? override[field.key]
                  : inherited;
                return (
                  <Field key={field.key} label={field.label}>
                    <div className="flex items-center gap-2">
                      <input
                        data-testid={`model-override-${field.key}`}
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={overridden ? (override[field.key] as number) : ""}
                        placeholder={
                          inherited === undefined ? "inherit default" : `inherit ${inherited}`
                        }
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          if (raw === "") {
                            setModelOverride(field.key, undefined);
                            return;
                          }
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return;
                          setModelOverride(field.key, field.step === 1 ? Math.trunc(n) : n);
                        }}
                        className={inputClass}
                      />
                      {overridden && (
                        <button
                          type="button"
                          data-testid={`clear-model-override-${field.key}`}
                          className="shrink-0 text-[10px] text-zinc-400 hover:text-zinc-200"
                          onClick={() => setModelOverride(field.key, undefined)}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-600">
                      {overridden ? "Override" : "Inherited"} · effective{" "}
                      {effective === undefined ? "provider default" : String(effective)}
                    </p>
                  </Field>
                );
              })}
            </div>
          )}

          {supportsActiveTools && (
            <Field label="Active tools">
              <select
                data-testid="step-active-tools-mode"
                value={toolsMode}
                onChange={(event) => {
                  const mode = event.target.value as ActiveToolsMode;
                  if (mode === "inherit") {
                    updateNodeConfig(node.id, { activeTools: undefined });
                  } else if (mode === "empty") {
                    updateNodeConfig(node.id, { activeTools: [] });
                  } else {
                    updateNodeConfig(node.id, {
                      activeTools: config.activeTools?.length ? config.activeTools : [...agent.tools],
                    });
                  }
                }}
                className={inputClass}
              >
                <option value="inherit">Inherit agent tools</option>
                <option value="empty">No tools for this step</option>
                <option value="subset">Subset of agent tools</option>
              </select>
              {toolsMode === "subset" && (
                <div className="mt-2 space-y-1" data-testid="step-active-tools-subset">
                  {agent.tools.map((toolId) => {
                    const label = tools.find((t) => t.id === toolId)?.name ?? toolId;
                    const checked = (config.activeTools ?? []).includes(toolId);
                    return (
                      <label key={toolId} className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const current = new Set(config.activeTools ?? []);
                            if (event.target.checked) current.add(toolId);
                            else current.delete(toolId);
                            updateNodeConfig(node.id, { activeTools: [...current] });
                          }}
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>
          )}

          <Field label="Node execution mode override">
            <select
              data-testid="node-execution-mode"
              value={config.executionMode ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                updateNodeConfig(node.id, {
                  executionMode: value === "single_turn" || value === "react" ? value : undefined,
                });
              }}
              className={inputClass}
            >
              <option value="">— use agent default —</option>
              <option value="single_turn">Single-turn</option>
              <option value="react">ReAct (autonomous)</option>
            </select>
          </Field>
          <Field label="Node max tool steps override">
            <input
              data-testid="node-max-tool-steps"
              type="number"
              min={1}
              max={10}
              value={config.maxToolSteps ?? ""}
              placeholder="—"
              onChange={(event) => {
                const raw = event.target.value.trim();
                updateNodeConfig(node.id, {
                  maxToolSteps: raw === "" ? undefined : clampToolStepsInput(raw),
                });
              }}
              className={inputClass}
            />
          </Field>
        </>
      )}
    </div>
  );
}

export function ToolForm({ node }: { node: WorkflowNode }) {
  const config = node.config as ToolNodeConfig;
  const tools = useWorkflowStore((s) => s.tools);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const updateToolRecord = useWorkflowStore((s) => s.updateToolRecord);

  const tool = tools.find((t) => t.id === config.toolId);

  const patchTool = (patch: Partial<ToolRecord>) => {
    if (!tool) return;
    updateToolRecord(tool.id, patch);
  };

  return (
    <div className="space-y-3">
      <Field label="Linked Tool">
        <select
          value={config.toolId ?? ""}
          onChange={(event) => updateNodeConfig(node.id, { toolId: event.target.value || null })}
          className={inputClass}
        >
          <option value="">— not linked —</option>
          {tools.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-zinc-600">
          Tool configuration lives in the registry and is shared between nodes.
        </p>
      </Field>

      {tool && (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={tool.enabled}
              onChange={(event) => patchTool({ enabled: event.target.checked })}
            />
            Enabled
          </label>
          <Field label="Name">
            <input
              type="text"
              value={tool.name}
              onChange={(event) => patchTool({ name: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Category">
            <select
              value={tool.category}
              onChange={(event) => patchTool({ category: event.target.value as ToolRecord["category"] })}
              className={inputClass}
            >
              {TOOL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea
              value={tool.description}
              onChange={(event) => patchTool({ description: event.target.value })}
              rows={3}
              className={inputClass}
            />
          </Field>
          <JsonField
            label="Configuration"
            value={tool.configuration}
            onChange={(configuration) => patchTool({ configuration })}
          />
        </>
      )}
    </div>
  );
}

export function ApprovalForm({ node }: { node: WorkflowNode }) {
  const config = node.config as ApprovalNodeConfig;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  return (
    <div className="space-y-3">
      <Field label="Approval Message">
        <textarea
          value={config.message}
          onChange={(event) => updateNodeConfig(node.id, { message: event.target.value })}
          rows={3}
          placeholder="Review the generated plan and approve to continue…"
          className={inputClass}
        />
      </Field>
      <Field label="Approval Type">
        <select
          value={config.approvalType}
          onChange={(event) =>
            updateNodeConfig(node.id, { approvalType: event.target.value })
          }
          className={inputClass}
        >
          <option value="manual">Manual — wait for human</option>
          <option value="timeout">Timeout — auto-approve after</option>
        </select>
      </Field>
      {config.approvalType === "timeout" && (
        <Field label="Timeout (seconds)">
          <input
            type="number"
            min={1}
            value={config.timeoutSeconds}
            onChange={(event) =>
              updateNodeConfig(node.id, { timeoutSeconds: Number(event.target.value) || 0 })
            }
            className={inputClass}
          />
        </Field>
      )}
    </div>
  );
}

export function MemoryForm({ node }: { node: WorkflowNode }) {
  const config = node.config as MemoryNodeConfig;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  return (
    <div className="space-y-3">
      <Field label="Memory Type">
        <select
          value={config.memoryType}
          onChange={(event) => updateNodeConfig(node.id, { memoryType: event.target.value })}
          className={inputClass}
        >
          <option value="short_term">Short term (per run)</option>
          <option value="long_term">Long term (persistent)</option>
          <option value="shared">Shared (cross-agent)</option>
        </select>
      </Field>
      <Field label="Access Mode">
        <select
          value={config.mode}
          onChange={(event) => updateNodeConfig(node.id, { mode: event.target.value })}
          className={inputClass}
        >
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="read_write">Read / Write</option>
        </select>
      </Field>
      {config.mode !== "read" && (
        <Field label="Write Source">
          <select
            value={config.writeSource ?? "last_value"}
            onChange={(event) => updateNodeConfig(node.id, { writeSource: event.target.value })}
            className={inputClass}
          >
            <option value="last_value">Immediately preceding value</option>
            <option value="node_results">All completed node results</option>
            <option value="handoffs">Structured agent handoffs</option>
            <option value="run_report">Complete run report</option>
          </select>
          <p className="mt-1 text-xs text-zinc-500">Use a complete run report for final evidence aggregation.</p>
        </Field>
      )}
      <Field label="Memory Key">
        <input
          type="text"
          value={config.key}
          onChange={(event) => updateNodeConfig(node.id, { key: event.target.value })}
          placeholder="e.g. project_context"
          className={cn(inputClass, "font-mono text-[11px]")}
        />
      </Field>
    </div>
  );
}

export function ConditionForm({ node }: { node: WorkflowNode }) {
  const config = node.config as ConditionNodeConfig;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  const updateBranch = (index: number, patch: Partial<{ key: string; label: string }>) => {
    const branches = config.branches.map((branch, i) =>
      i === index ? { ...branch, ...patch } : branch
    );
    updateNodeConfig(node.id, { branches });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className={labelClass}>Branches (outgoing paths)</label>
        {config.branches.map((branch, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="text"
              value={branch.key}
              onChange={(event) => updateBranch(index, { key: event.target.value })}
              placeholder="key"
              className={cn(inputClass, "w-20 font-mono text-[11px]")}
            />
            <input
              type="text"
              value={branch.label}
              onChange={(event) => updateBranch(index, { label: event.target.value })}
              placeholder="Label"
              className={cn(inputClass, "flex-1")}
            />
            <button
              type="button"
              title="Remove branch"
              onClick={() =>
                updateNodeConfig(node.id, {
                  branches: config.branches.filter((_, i) => i !== index),
                })
              }
              className="text-zinc-500 hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            updateNodeConfig(node.id, {
              branches: [...config.branches, { key: "", label: "" }],
            })
          }
          className="w-full rounded-lg border border-dashed border-zinc-700 py-1.5 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 cursor-pointer"
        >
          + Add branch
        </button>
      </div>
      <Field label="Branch Source">
        <select
          value={config.valueSource ?? "input"}
          onChange={(event) =>
            updateNodeConfig(node.id, {
              valueSource: event.target.value === "last_value" ? "last_value" : "input",
            })
          }
          className={inputClass}
        >
          <option value="input">Run input (legacy-compatible input routing)</option>
          <option value="last_value">Previous node result</option>
        </select>
      </Field>
      <Field label="Result Field (optional)">
        <input
          type="text"
          value={config.valueField ?? ""}
          onChange={(event) =>
            updateNodeConfig(node.id, { valueField: event.target.value.trim() || undefined })
          }
          placeholder="e.g. status"
          className={cn(inputClass, "font-mono text-[11px]")}
        />
        <p className="text-[10px] text-zinc-600">
          Field of the selected carrier that holds the structured result / branch value.
        </p>
      </Field>
      <Field label="Unknown / Error Route">
        <select
          value={config.unknownRoute ?? ""}
          onChange={(event) =>
            updateNodeConfig(node.id, { unknownRoute: event.target.value || undefined })
          }
          className={inputClass}
        >
          <option value="">— fail closed with BRANCH_ROUTING_UNKNOWN —</option>
          {config.branches
            .filter((branch) => branch.key.trim())
            .map((branch) => (
              <option key={branch.key} value={branch.key}>
                {branch.key}
              </option>
            ))}
        </select>
        <p className="text-[10px] text-zinc-600">
          Route taken when the branch value is missing, malformed, undeclared, mistyped, or
          ambiguous. Without an explicit route the run fails instead of falling back to the
          first branch.
        </p>
      </Field>
      <Field label="Malformed / Type Error Route">
        <select
          value={config.errorRoute ?? ""}
          onChange={(event) => updateNodeConfig(node.id, { errorRoute: event.target.value || undefined })}
          className={inputClass}
        >
          <option value="">— use unknown route or fail closed —</option>
          {config.branches.filter((branch) => branch.key.trim()).map((branch) => (
            <option key={branch.key} value={branch.key}>{branch.key}</option>
          ))}
        </select>
        <p className="text-[10px] text-zinc-600">
          Handles missing, malformed, or mistyped branch carriers separately from valid-but-undeclared values.
        </p>
      </Field>
      <p className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-[10px] leading-relaxed text-zinc-500">
        Connect each branch handle (bottom of the node) to a target. The edge inherits the branch
        key — edit it on the edge itself.
      </p>
    </div>
  );
}

/**
 * Generic versioned input/output contract editor. Domain-agnostic: it edits
 * only the schema/version/bounds declared on the node itself.
 */
export function ContractForm({ node }: { node: WorkflowNode }) {
  const updateNodeContract = useWorkflowStore((s) => s.updateNodeContract);
  const contract: NodeContract = node.contract ?? { version: NODE_CONTRACT_VERSION };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2.5">
      <div className="flex items-center justify-between">
        <label className={labelClass}>I/O Contract</label>
        <span className="text-[10px] text-zinc-500">
          {node.contract ? `version ${contract.version}` : "not set (unvalidated beyond bounds)"}
        </span>
      </div>
      <JsonField
        label="Input Schema (JSON)"
        value={(contract.inputSchema ?? {}) as Record<string, unknown>}
        onChange={(inputSchema) => updateNodeContract(node.id, { ...contract, version: contract.version || NODE_CONTRACT_VERSION, inputSchema })}
      />
      <JsonField
        label="Output Schema (JSON)"
        value={(contract.outputSchema ?? {}) as Record<string, unknown>}
        onChange={(outputSchema) => updateNodeContract(node.id, { ...contract, version: contract.version || NODE_CONTRACT_VERSION, outputSchema })}
      />
      <Field label="Max payload bytes (optional)">
        <input
          type="number"
          min={1024}
          max={10 * 1024 * 1024}
          value={contract.maxPayloadBytes ?? ""}
          onChange={(event) =>
            updateNodeContract(node.id, {
              ...contract,
              version: contract.version || NODE_CONTRACT_VERSION,
              maxPayloadBytes: event.target.value ? Number(event.target.value) : undefined,
            })
          }
          placeholder="default: no node-level bound"
          className={cn(inputClass, "font-mono text-[11px]")}
        />
      </Field>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={contract.captureEvidence === true}
          onChange={(event) =>
            updateNodeContract(node.id, {
              ...contract,
              version: contract.version || NODE_CONTRACT_VERSION,
              captureEvidence: event.target.checked || undefined,
            })
          }
        />
        Capture evidence / provenance on results
      </label>
    </div>
  );
}

export function IOPortalForm({
  node,
}: {
  node: WorkflowNode & { type: "input" | "output" };
}) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const isInput = node.type === "input";
  const key = isInput
    ? (node.config as InputNodeConfig).inputKey
    : (node.config as OutputNodeConfig).outputKey;
  const description = isInput
    ? (node.config as InputNodeConfig).description
    : (node.config as OutputNodeConfig).description;

  return (
    <div className="space-y-3">
      <Field label={isInput ? "Input Key" : "Output Key"}>
        <input
          type="text"
          value={key}
          onChange={(event) => updateNodeConfig(node.id, { [isInput ? "inputKey" : "outputKey"]: event.target.value })}
          className={cn(inputClass, "font-mono text-[11px]")}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(event) => updateNodeConfig(node.id, { description: event.target.value })}
          rows={3}
          className={inputClass}
        />
      </Field>
    </div>
  );
}
