"use client";

import React, { useMemo, useState } from "react";
import { Bot, CircleAlert, GitBranch, Trash2, Wrench } from "lucide-react";
import {
  AgentBackend,
  AgentNodeConfig,
  AgentRecord,
  ApprovalNodeConfig,
  ConditionNodeConfig,
  InputNodeConfig,
  MemoryNodeConfig,
  NODE_TYPE_META,
  ToolNodeConfig,
  OutputNodeConfig,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const labelClass = "text-[10px] font-bold uppercase tracking-widest text-zinc-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

/** JSON object field that only commits valid JSON. */
function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, string | number | boolean>;
  onChange: (next: Record<string, string | number | boolean>) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setRaw(next);
    if (next.trim() === "") {
      setError(null);
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(next) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Must be a JSON object");
        return;
      }
      setError(null);
      onChange(parsed as Record<string, string | number | boolean>);
    } catch {
      setError("Invalid JSON");
    }
  };

  return (
    <Field label={label}>
      <textarea
        value={raw}
        onChange={(event) => handleChange(event.target.value)}
        rows={4}
        spellCheck={false}
        className={cn(
          inputClass,
          "font-mono text-[11px]",
          error && "border-red-500/70 focus:ring-red-500"
        )}
      />
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Node forms
// ---------------------------------------------------------------------------

function AgentForm({ node }: { node: WorkflowNode }) {
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
              <option value="cli">CLI agent (soon)</option>
              <option value="local">Local model (soon)</option>
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

function ToolForm({ node }: { node: WorkflowNode }) {
  const config = node.config as ToolNodeConfig;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  return (
    <div className="space-y-3">
      <Field label="Tool ID">
        <input
          type="text"
          value={config.toolId}
          onChange={(event) => updateNodeConfig(node.id, { toolId: event.target.value })}
          className={cn(inputClass, "font-mono text-[11px]")}
        />
      </Field>
      <Field label="Name">
        <input
          type="text"
          value={config.name}
          onChange={(event) => updateNodeConfig(node.id, { name: event.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={config.description}
          onChange={(event) => updateNodeConfig(node.id, { description: event.target.value })}
          rows={3}
          className={inputClass}
        />
      </Field>
      <JsonField
        label="Configuration"
        value={config.config}
        onChange={(next) => updateNodeConfig(node.id, { config: next })}
      />
    </div>
  );
}

function ApprovalForm({ node }: { node: WorkflowNode }) {
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

function MemoryForm({ node }: { node: WorkflowNode }) {
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

function ConditionForm({ node }: { node: WorkflowNode }) {
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
      <p className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-[10px] leading-relaxed text-zinc-500">
        Connect each branch handle (bottom of the node) to a target. The edge inherits the branch
        key — edit it on the edge itself.
      </p>
    </div>
  );
}

function IOPortalForm({
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

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function NodeProperties({ node }: { node: WorkflowNode }) {
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const issues = useWorkflowStore((s) => s.issues);
  const nodeIssues = useMemo(
    () => issues.filter((issue) => issue.nodeId === node.id),
    [issues, node.id]
  );
  const meta = NODE_TYPE_META[node.type];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                meta.chipBg,
                meta.iconText
              )}
            >
              {meta.label}
            </span>
            {nodeIssues.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                <CircleAlert className="h-3 w-3" />
                {nodeIssues.length}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">{node.id}</p>
        </div>
        <button
          type="button"
          title="Delete node"
          onClick={() => removeNodes([node.id])}
          className="text-zinc-500 hover:text-red-400 cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {nodeIssues.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-900/50 bg-red-950/20 p-2">
          {nodeIssues.map((issue) => (
            <p
              key={issue.id}
              className={cn(
                "text-[11px] leading-snug",
                issue.severity === "error" ? "text-red-300" : "text-amber-300"
              )}
            >
              • {issue.message}
            </p>
          ))}
        </div>
      )}

      {node.type === "agent" && <AgentForm node={node} />}
      {node.type === "tool" && <ToolForm node={node} />}
      {node.type === "approval" && <ApprovalForm node={node} />}
      {node.type === "memory" && <MemoryForm node={node} />}
      {node.type === "condition" && <ConditionForm node={node} />}
      {(node.type === "input" || node.type === "output") && (
        <IOPortalForm node={node as WorkflowNode & { type: "input" | "output" }} />
      )}
    </div>
  );
}

function EdgeProperties({ edge }: { edge: WorkflowEdge }) {
  const definition = useWorkflowStore((s) => s.definition);
  const updateEdge = useWorkflowStore((s) => s.updateEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);

  const sourceNode = definition.nodes.find((n) => n.id === edge.source);
  const targetNode = definition.nodes.find((n) => n.id === edge.target);
  const sourceIsCondition = sourceNode?.type === "condition";
  const branches =
    sourceIsCondition && sourceNode
      ? (sourceNode.config as ConditionNodeConfig).branches
      : [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            {edge.kind === "conditional" ? (
              <GitBranch className="h-3.5 w-3.5 text-purple-300" />
            ) : (
              <Wrench className="h-3.5 w-3.5 text-zinc-400" />
            )}
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              {edge.kind} edge
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">{edge.id}</p>
        </div>
        <button
          type="button"
          title="Delete edge"
          onClick={() => removeEdges([edge.id])}
          className="text-zinc-500 hover:text-red-400 cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-zinc-500" />
          <span className="truncate">{sourceNode ? nodeTitle(sourceNode) : edge.source}</span>
        </div>
        <div className="ml-1.5 border-l border-zinc-700 pl-2 text-zinc-600">↓</div>
        <div className="flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-zinc-500" />
          <span className="truncate">{targetNode ? nodeTitle(targetNode) : edge.target}</span>
        </div>
      </div>

      <Field label="Edge Type">
        <select
          value={edge.kind}
          onChange={(event) => updateEdge(edge.id, { kind: event.target.value as WorkflowEdge["kind"] })}
          className={inputClass}
        >
          <option value="normal">Normal</option>
          <option value="conditional">Conditional</option>
        </select>
      </Field>

      {edge.kind === "conditional" && (
        <Field label="Branch Key (condition value)">
          {branches.length > 0 ? (
            <select
              value={edge.branchKey}
              onChange={(event) => updateEdge(edge.id, { branchKey: event.target.value })}
              className={inputClass}
            >
              <option value="">— select branch —</option>
              {branches.map((branch) => (
                <option key={branch.key} value={branch.key}>
                  {branch.key}
                  {branch.label ? ` (${branch.label})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={edge.branchKey}
              onChange={(event) => updateEdge(edge.id, { branchKey: event.target.value })}
              placeholder='e.g. "approved"'
              className={cn(inputClass, "font-mono text-[11px]")}
            />
          )}
        </Field>
      )}

      <Field label="Label (display only)">
        <input
          type="text"
          value={edge.label}
          onChange={(event) => updateEdge(edge.id, { label: event.target.value })}
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function MultiSelectProperties({ nodeIds }: { nodeIds: string[] }) {
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  return (
    <div className="space-y-3 text-center">
      <p className="text-xs text-zinc-400">
        {nodeIds.length} nodes selected
      </p>
      <button
        type="button"
        onClick={() => removeNodes(nodeIds)}
        className="w-full rounded-lg border border-red-900/60 bg-red-950/30 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/60 cursor-pointer"
      >
        Delete selected nodes
      </button>
    </div>
  );
}

function Overview() {
  const definition = useWorkflowStore((s) => s.definition);
  const issues = useWorkflowStore((s) => s.issues);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const counts = new Map<string, number>();
  for (const node of definition.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Workflow</h3>
        <p className="mt-1 font-mono text-[10px] text-zinc-600">{definition.id}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Nodes</div>
          <div className="text-sm font-bold text-zinc-100">{definition.nodes.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Edges</div>
          <div className="text-sm font-bold text-zinc-100">{definition.edges.length}</div>
        </div>
      </div>

      {counts.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...counts.entries()].map(([type, count]) => (
            <span
              key={type}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                NODE_TYPE_META[type as keyof typeof NODE_TYPE_META]?.chipBg ?? "bg-zinc-800",
                NODE_TYPE_META[type as keyof typeof NODE_TYPE_META]?.iconText ?? "text-zinc-300"
              )}
            >
              {type} × {count}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-500">
        <p className="font-semibold text-zinc-400">Validation</p>
        {issues.length === 0 || (errors === 0 && warnings === 0) ? (
          <p className="mt-1 text-emerald-400">No issues — workflow looks valid.</p>
        ) : (
          <p className="mt-1">
            <span className={errors > 0 ? "text-red-400" : "text-zinc-500"}>{errors} errors</span>
            {" · "}
            <span className={warnings > 0 ? "text-amber-400" : "text-zinc-500"}>
              {warnings} warnings
            </span>
          </p>
        )}
        <p className="mt-2 text-[10px] text-zinc-600">
          Select a node or edge to inspect and configure it. The backend compiles this definition
          into a LangGraph StateGraph on execution.
        </p>
      </div>
    </div>
  );
}

function nodeTitle(node: WorkflowNode): string {
  switch (node.type) {
    case "agent":
      return "Agent node";
    case "tool":
      return (node.config as ToolNodeConfig).name || "Tool node";
    case "condition":
      return "Condition / Router";
    case "approval":
      return "Human Approval";
    case "memory":
      return "Memory node";
    default:
      return node.type;
  }
}

export function PropertiesPanel() {
  const definition = useWorkflowStore((s) => s.definition);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useWorkflowStore((s) => s.selectedEdgeIds);

  const selectedNode =
    selectedNodeIds.length === 1
      ? definition.nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;
  const selectedEdge =
    selectedNodeIds.length === 0 && selectedEdgeIds.length === 1
      ? definition.edges.find((e) => e.id === selectedEdgeIds[0])
      : undefined;

  return (
    <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-zinc-800/80 bg-zinc-950/60 p-3">
      {selectedNode && <NodeProperties node={selectedNode} />}
      {!selectedNode && selectedEdge && <EdgeProperties edge={selectedEdge} />}
      {!selectedNode && !selectedEdge && selectedNodeIds.length > 1 && (
        <MultiSelectProperties nodeIds={selectedNodeIds} />
      )}
      {!selectedNode && !selectedEdge && selectedNodeIds.length <= 1 && <Overview />}
    </aside>
  );
}
