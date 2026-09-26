"use client";

/**
 * Per-node-type configuration forms for the properties panel.
 * Each form owns exactly one node type's config editing.
 */

import { Trash2 } from "lucide-react";
import {
  AgentBackend,
  AgentExecutionPolicy,
  AgentNodeConfig,
  AgentRecord,
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
} from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import { Field, JsonField, inputClass, labelClass } from "./fields";

export function AgentForm({ node }: { node: WorkflowNode }) {
  const config = node.config as AgentNodeConfig;
  const agents = useWorkflowStore((s) => s.agents);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const updateAgentRecord = useWorkflowStore((s) => s.updateAgentRecord);

  const agent = agents.find((a) => a.id === config.agentId);

  const patchAgent = (patch: Partial<AgentRecord>) => {
    if (!agent) return;
    updateAgentRecord(agent.id, patch);
  };

  return (
    <div className="space-y-3">
      <Field label="Linked Agent">
        <select
          value={config.agentId ?? ""}
          onChange={(event) => updateNodeConfig(node.id, { agentId: event.target.value || null })}
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
          Agent configuration lives in the registry and is shared between nodes.
        </p>
      </Field>

      {agent && (
        <>
          <Field label="Name">
            <input
              type="text"
              value={agent.name}
              onChange={(event) => patchAgent({ name: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Backend">
            <select
              value={agent.backend.type}
              onChange={(event) => {
                const type = event.target.value as AgentBackend["type"];
                if (type === "api") {
                  patchAgent({
                    backend: {
                      type: "api",
                      provider:
                        agent.backend.type === "api" ? agent.backend.provider : "openai",
                      model:
                        "model" in agent.backend && agent.backend.model
                          ? agent.backend.model
                          : "gpt-4o",
                    },
                  });
                } else if (type === "cli") {
                  patchAgent({
                    backend: {
                      type: "cli",
                      provider:
                        agent.backend.type === "cli" ? agent.backend.provider : "codex",
                      model: "model" in agent.backend ? agent.backend.model : undefined,
                    },
                  });
                } else {
                  patchAgent({
                    backend: {
                      type: "local",
                      provider:
                        agent.backend.type === "local" ? agent.backend.provider : "ollama",
                      model:
                        "model" in agent.backend && agent.backend.model
                          ? agent.backend.model
                          : "llama3",
                    },
                  });
                }
              }}
              className={inputClass}
            >
              <option value="api">API provider</option>
              <option value="cli">CLI agent</option>
              <option value="local">Local model</option>
            </select>
          </Field>
          <Field label="Provider">
            <input
              type="text"
              value={agent.backend.provider}
              onChange={(event) =>
                patchAgent({
                  backend: { ...agent.backend, provider: event.target.value } as AgentBackend,
                })
              }
              placeholder="openai, anthropic, codex, ollama…"
              className={inputClass}
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={"model" in agent.backend ? agent.backend.model ?? "" : ""}
              onChange={(event) =>
                patchAgent({
                  backend: { ...agent.backend, model: event.target.value } as AgentBackend,
                })
              }
              placeholder="gpt-4o, claude-sonnet, llama3…"
              className={inputClass}
            />
          </Field>
          {agent.backend.type === "cli" && <>
            <Field label="Executable (optional)"><input className={inputClass} value={agent.backend.executable ?? ""} placeholder="codex, claude, agent, or agy" onChange={(event) => patchAgent({ backend: { ...agent.backend, executable: event.target.value || undefined } as AgentBackend })} /></Field>
            <Field label="Arguments (one per line)"><textarea className={inputClass} rows={3} value={(agent.backend.args ?? []).join("\n")} onChange={(event) => patchAgent({ backend: { ...agent.backend, args: event.target.value ? event.target.value.split("\n") : undefined } as AgentBackend })} /></Field>
            <Field label="Workspace root"><input className={inputClass} value={agent.executionPolicy?.workspaceRoot ?? ""} onChange={(event) => patchAgent({ executionPolicy: { ...agent.executionPolicy, workspaceRoot: event.target.value || undefined } })} /></Field>
            <Field label="Shell access"><select className={inputClass} value={agent.executionPolicy?.shell ?? "disabled"} onChange={(event) => patchAgent({ executionPolicy: { ...agent.executionPolicy, shell: event.target.value as AgentExecutionPolicy["shell"] } })}><option value="disabled">Disabled</option><option value="restricted">Restricted</option><option value="full">Full</option></select></Field>
            <Field label="Filesystem access"><select className={inputClass} value={agent.executionPolicy?.filesystem ?? "none"} onChange={(event) => patchAgent({ executionPolicy: { ...agent.executionPolicy, filesystem: event.target.value as AgentExecutionPolicy["filesystem"] } })}><option value="none">None</option><option value="read">Read</option><option value="read-write">Read/write</option></select></Field>
            <Field label="Allowed commands (one per line)"><textarea className={inputClass} rows={3} value={(agent.executionPolicy?.allowedCommands ?? []).join("\n")} onChange={(event) => patchAgent({ executionPolicy: { ...agent.executionPolicy, allowedCommands: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } })} /></Field>
          </>}
          {agent.backend.type === "local" && <Field label="Base URL (optional)"><input type="url" className={inputClass} value={agent.backend.baseUrl ?? ""} placeholder={agent.backend.provider === "lmstudio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:11434"} onChange={(event) => patchAgent({ backend: { ...agent.backend, baseUrl: event.target.value || undefined } as AgentBackend })} /></Field>}
          <Field label="Description">
            <textarea
              value={agent.description}
              onChange={(event) => patchAgent({ description: event.target.value })}
              rows={2}
              className={inputClass}
            />
          </Field>
          <Field label="System Prompt">
            <textarea
              value={agent.systemPrompt}
              onChange={(event) => patchAgent({ systemPrompt: event.target.value })}
              rows={5}
              placeholder="You are a senior code reviewer…"
              className={cn(inputClass, "font-mono text-[11px]")}
            />
          </Field>
          <Field label="Tools (one per line)">
            <textarea
              value={agent.tools.join("\n")}
              onChange={(event) =>
                patchAgent({
                  tools: event.target.value
                    .split("\n")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              rows={3}
              placeholder={"web_search\ncode_exec"}
              className={cn(inputClass, "font-mono text-[11px]")}
            />
          </Field>
          <JsonField
            label="Metadata"
            value={agent.metadata}
            onChange={(metadata) => patchAgent({ metadata })}
          />
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
