"use client";

import React, { useEffect } from "react";
import {
  ARCHETYPE_DESCRIPTORS,
  MAX_EXECUTION_STEPS,
  MAX_RECURSION_ITERATIONS,
  MIN_EXECUTION_STEPS,
  MIN_RECURSION_ITERATIONS,
  isLegacyUntypedWorkflow,
  resolveWorkflowArchetype,
  type WorkflowArchetypeCategory,
  type WorkflowNode,
} from "@multi-agent/types";
import { AlertCircle, Info, Plus, Trash2 } from "lucide-react";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import {
  PanelSection,
  checkboxClass,
  inputClass,
  labelClass,
  selectChevronStyle,
  selectClass,
} from "./fields";

const ARCHETYPE_ORDER: WorkflowArchetypeCategory[] = [
  "linear-pipeline",
  "hierarchical-supervisor",
  "evaluator-optimizer",
  "autonomous-swarm",
];

const FOCUS_TARGETS: Record<string, string> = {
  INVALID_ARCHETYPE: "archetype-selector",
  MISSING_SUPERVISOR_HUB: "supervisor-hub-select",
  INVALID_SUPERVISOR_HUB: "supervisor-hub-select",
  MISSING_ROUTING_NODES: "supervisor-config",
  UNGUARDED_CYCLE: "recursion-guards",
  INVALID_RECURSION_GUARD: "recursion-guard-route-0",
  FALLBACK_NOT_WIRED: "recursion-guard-fallback-0",
  MISSING_APPROVAL_GATE: "human-approval-gate",
  APPROVAL_GATE_BYPASS: "human-approval-gate",
  LINEAR_PIPELINE_CYCLE_FORBIDDEN: "archetype-selector",
  EVALUATOR_OPTIMIZER_CONFIG_REQUIRED: "archetype-selector",
  EVALUATOR_OPTIMIZER_ROLE_INVALID: "archetype-selector",
  EVALUATOR_OPTIMIZER_CEILING_REQUIRED: "archetype-selector",
  EVALUATOR_OPTIMIZER_CYCLE_INVALID: "archetype-selector",
  EVALUATOR_OPTIMIZER_ROUTING_INVALID: "archetype-selector",
  EVALUATOR_OPTIMIZER_EXHAUSTION_UNWIRED: "archetype-selector",
  PARALLEL_SPLIT_JOIN_MISMATCH: "archetype-selector",
  PARALLEL_BRANCH_LIMIT_EXCEEDED: "archetype-selector",
  PARALLEL_JOIN_POLICY_INVALID: "archetype-selector",
  SUBGRAPH_REF_MISSING: "archetype-selector",
  SUBGRAPH_MAPPING_INVALID: "archetype-selector",
  SUBGRAPH_NESTING_UNSAFE: "archetype-selector",
  SUBGRAPH_DEPTH_EXCEEDED: "archetype-selector",
  SWARM_BOUNDS_REQUIRED: "archetype-selector",
  SWARM_BOUNDS_INVALID: "archetype-selector",
  SWARM_UNBOUNDED_PEER_LOOP: "archetype-selector",
};

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Editing archetype settings requires organization `resources.write` (`member`, `admin`, or `owner`). */
export function useCanEditArchetype(): boolean {
  const role = useOptionalOrg()?.org.role;
  if (!role) return true;
  return role === "member" || role === "admin" || role === "owner";
}

function useFocusOnIssue(elementId: string, codes: readonly string[]) {
  const focusedIssueCode = useWorkflowStore((state) => state.focusedIssueCode);
  const codeKey = codes.join("|");
  useEffect(() => {
    if (!focusedIssueCode || !codeKey.split("|").filter(Boolean).includes(focusedIssueCode)) return;
    document.getElementById(elementId)?.focus();
  }, [focusedIssueCode, elementId, codeKey]);
}

export function ArchetypeSection() {
  const definition = useWorkflowStore((state) => state.definition);
  const setWorkflowArchetype = useWorkflowStore((state) => state.setWorkflowArchetype);
  const canEdit = useCanEditArchetype();
  const effective = resolveWorkflowArchetype(definition);
  const descriptor = ARCHETYPE_DESCRIPTORS[effective];
  const legacy = isLegacyUntypedWorkflow(definition);
  const dormant =
    effective === "linear-pipeline" &&
    Boolean(
      definition.archetypeConfig?.supervisorHubNodeId ||
        (definition.archetypeConfig?.recursionGuards?.length ?? 0) > 0 ||
        definition.archetypeConfig?.evaluatorOptimizer ||
        definition.archetypeConfig?.swarm,
    );
  useFocusOnIssue("archetype-selector", ["INVALID_ARCHETYPE", "LINEAR_PIPELINE_CYCLE_FORBIDDEN"]);

  return (
    <PanelSection
      title="Archetype"
      badge={
        <span
          className={cn(
            "inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-medium",
            effective === "hierarchical-supervisor"
              ? "studio-badge-purple border-purple-500/35 bg-purple-950/50 text-purple-300"
              : "studio-badge-blue border-blue-500/35 bg-blue-950/50 text-blue-300",
          )}
        >
          {descriptor.label}
          {legacy ? " · Legacy" : ""}
        </span>
      }
    >
      <label className="block space-y-1.5">
        <span className="sr-only">Active archetype</span>
        <select
          id="archetype-selector"
          aria-label="Active archetype"
          disabled={!canEdit}
          value={effective}
          style={selectChevronStyle()}
          onChange={(event) => setWorkflowArchetype(event.target.value as WorkflowArchetypeCategory)}
          className={cn(
            selectClass,
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {ARCHETYPE_ORDER.map((id) => (
            <option key={id} value={id}>
              {ARCHETYPE_DESCRIPTORS[id].label}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-1.5 rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-2.5 text-[11px] leading-relaxed">
        <p className="text-zinc-300">{descriptor.description}</p>
        <p className="text-zinc-400">{descriptor.topologyConstraint}</p>
      </div>

      {legacy && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-2.5 text-[11px] leading-relaxed text-zinc-400"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
          <p>
            This workflow has no explicit archetype yet. Saving Linear Pipeline or Hierarchical
            Supervisor promotes it to strict validation.
          </p>
        </div>
      )}

      {dormant && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-950/35 p-2.5 text-[11px] leading-relaxed text-blue-200"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" aria-hidden="true" />
          <p>
            Supervisor / evaluator-optimizer / swarm settings are preserved in a dormant state while
            configured as Linear Pipeline.
          </p>
        </div>
      )}
    </PanelSection>
  );
}

export function SupervisorHubPicker({ agentNodes }: { agentNodes: WorkflowNode[] }) {
  const definition = useWorkflowStore((state) => state.definition);
  const agents = useWorkflowStore((state) => state.agents);
  const updateSupervisorConfig = useWorkflowStore((state) => state.updateSupervisorConfig);
  const issues = useWorkflowStore((state) => state.issues);
  const canEdit = useCanEditArchetype();
  const hubId = definition.archetypeConfig?.supervisorHubNodeId ?? "";
  const hubIssue = issues.find(
    (issue) => issue.code === "INVALID_SUPERVISOR_HUB" || issue.code === "MISSING_SUPERVISOR_HUB",
  );
  const missing = Boolean(hubId) && !agentNodes.some((node) => node.id === hubId);
  useFocusOnIssue("supervisor-hub-select", ["MISSING_SUPERVISOR_HUB", "INVALID_SUPERVISOR_HUB"]);

  return (
    <PanelSection>
      <div className="space-y-1.5">
        <label className={labelClass} htmlFor="supervisor-hub-select">
          Supervisor hub
        </label>
        <select
          id="supervisor-hub-select"
          aria-label="Supervisor hub"
          aria-invalid={Boolean(hubIssue) || missing}
          aria-describedby={hubIssue || missing ? "supervisor-hub-error" : undefined}
          disabled={!canEdit || agentNodes.length === 0}
          value={agentNodes.some((node) => node.id === hubId) ? hubId : ""}
          style={selectChevronStyle()}
          onChange={(event) =>
            updateSupervisorConfig({ supervisorHubNodeId: event.target.value })
          }
          className={cn(
            selectClass,
            "disabled:cursor-not-allowed disabled:opacity-50",
            (hubIssue || missing) && "border-red-500/80 focus-visible:ring-red-500",
          )}
        >
          <option value="">
            {agentNodes.length === 0
              ? "No agent nodes on canvas (add one from palette)"
              : "Select an agent node"}
          </option>
          {agentNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeLabel(node, agents)}
            </option>
          ))}
        </select>
        {(hubIssue || missing) && (
          <p
            id="supervisor-hub-error"
            role="alert"
            className="flex items-start gap-1.5 text-[11px] text-red-300"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {missing || hubIssue?.code === "INVALID_SUPERVISOR_HUB"
                ? `Selected hub node missing from canvas or not an agent${hubId ? ` (${hubId})` : ""}.`
                : hubIssue?.message}
            </span>
          </p>
        )}
      </div>
    </PanelSection>
  );
}

export function RecursionGuardsManager() {
  const definition = useWorkflowStore((state) => state.definition);
  const issues = useWorkflowStore((state) => state.issues);
  const addRecursionGuard = useWorkflowStore((state) => state.addRecursionGuard);
  const updateRecursionGuard = useWorkflowStore((state) => state.updateRecursionGuard);
  const removeRecursionGuard = useWorkflowStore((state) => state.removeRecursionGuard);
  const canEdit = useCanEditArchetype();
  const guards = definition.archetypeConfig?.recursionGuards ?? [];
  const branchKeys = conditionBranchKeys(definition.nodes);
  const guardInvalid = issues.some(
    (issue) =>
      issue.code === "INVALID_RECURSION_GUARD" ||
      issue.code === "FALLBACK_NOT_WIRED" ||
      issue.code === "UNGUARDED_CYCLE",
  );
  useFocusOnIssue("recursion-guards", ["UNGUARDED_CYCLE"]);
  useFocusOnIssue("recursion-guard-route-0", ["INVALID_RECURSION_GUARD"]);
  useFocusOnIssue("recursion-guard-fallback-0", ["FALLBACK_NOT_WIRED"]);

  return (
    <section
      id="recursion-guards"
      className="space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3"
      aria-label="Recursion guards"
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className={labelClass}>Recursion guards</h3>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() =>
            addRecursionGuard({
              routeKey: "feedback_loop",
              maxIterations: 3,
              fallbackBranch: "loop_limit_exceeded",
            })
          }
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700/90 bg-zinc-900 px-2 py-1 text-[10px] font-semibold text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add guard
        </button>
      </div>

      {guardInvalid && (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {
              issues.find(
                (issue) =>
                  issue.code === "UNGUARDED_CYCLE" ||
                  issue.code === "INVALID_RECURSION_GUARD" ||
                  issue.code === "FALLBACK_NOT_WIRED",
              )?.message
            }
          </span>
        </p>
      )}

      {guards.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-2.5 py-2 text-[11px] text-zinc-400">
          No recursion guards configured. Add one if this graph loops between agents.
        </p>
      )}

      <ul className="space-y-2">
        {guards.map((guard, index) => (
          <li
            key={`${guard.routeKey}-${index}`}
            className="space-y-2.5 rounded-lg border border-zinc-800/90 bg-zinc-950/55 p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Guard #{index + 1}
              </span>
              <button
                type="button"
                aria-label={`Delete guard ${index + 1}`}
                title={`Delete guard ${index + 1}`}
                disabled={!canEdit}
                onClick={() => removeRecursionGuard(index)}
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className={labelClass}>Route</span>
                <input
                  id={index === 0 ? "recursion-guard-route-0" : undefined}
                  aria-label={`Guard ${index + 1} route`}
                  disabled={!canEdit}
                  value={guard.routeKey}
                  onChange={(event) =>
                    updateRecursionGuard(index, { routeKey: event.target.value })
                  }
                  className={cn(
                    inputClass,
                    "font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Max iterations</span>
                <input
                  aria-label={`Guard ${index + 1} max iterations`}
                  type="number"
                  min={MIN_RECURSION_ITERATIONS}
                  max={MAX_RECURSION_ITERATIONS}
                  disabled={!canEdit}
                  value={guard.maxIterations}
                  onChange={(event) =>
                    updateRecursionGuard(index, {
                      maxIterations: clampInteger(
                        Number(event.target.value),
                        MIN_RECURSION_ITERATIONS,
                        MAX_RECURSION_ITERATIONS,
                        3,
                      ),
                    })
                  }
                  className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className={labelClass}>Fallback branch</span>
              <select
                id={index === 0 ? "recursion-guard-fallback-0" : undefined}
                aria-label={`Guard ${index + 1} fallback branch`}
                disabled={!canEdit}
                value={guard.fallbackBranch}
                style={selectChevronStyle()}
                onChange={(event) =>
                  updateRecursionGuard(index, { fallbackBranch: event.target.value })
                }
                className={cn(selectClass, "disabled:cursor-not-allowed disabled:opacity-50")}
              >
                {fallbackOptions(branchKeys, guard.fallbackBranch).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SupervisorExecutionLimitsForm() {
  const definition = useWorkflowStore((state) => state.definition);
  const updateSupervisorConfig = useWorkflowStore((state) => state.updateSupervisorConfig);
  const issues = useWorkflowStore((state) => state.issues);
  const canEdit = useCanEditArchetype();
  const steps = definition.archetypeConfig?.maxExecutionSteps ?? 1000;
  const approvalRequired = definition.archetypeConfig?.humanApprovalGateRequired ?? true;
  const approvalInvalid = issues.some(
    (issue) => issue.code === "MISSING_APPROVAL_GATE" || issue.code === "APPROVAL_GATE_BYPASS",
  );
  useFocusOnIssue("human-approval-gate", ["MISSING_APPROVAL_GATE", "APPROVAL_GATE_BYPASS"]);
  useFocusOnIssue("max-execution-steps", []);

  return (
    <section
      id="supervisor-config"
      className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3"
      aria-label="Supervisor execution limits"
      tabIndex={-1}
    >
      <h3 className={labelClass}>Execution Limits</h3>
      <label className="block space-y-1.5">
        <span className={labelClass}>Max execution steps</span>
        <input
          id="max-execution-steps"
          aria-label="Max execution steps"
          type="number"
          min={MIN_EXECUTION_STEPS}
          max={MAX_EXECUTION_STEPS}
          disabled={!canEdit}
          value={steps}
          onChange={(event) =>
            updateSupervisorConfig({
              maxExecutionSteps: clampInteger(
                Number(event.target.value),
                MIN_EXECUTION_STEPS,
                MAX_EXECUTION_STEPS,
                1000,
              ),
            })
          }
          className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
        />
      </label>

      <label className="flex items-start gap-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-2.5 text-[11px] text-zinc-200 cursor-pointer">
        <input
          id="human-approval-gate"
          aria-label="Require human approval before code changes"
          aria-invalid={approvalInvalid}
          aria-describedby="human-approval-help"
          type="checkbox"
          disabled={!canEdit}
          checked={approvalRequired}
          onChange={(event) =>
            updateSupervisorConfig({ humanApprovalGateRequired: event.target.checked })
          }
          className={cn(checkboxClass, "mt-0.5")}
        />
        <span>
          <span className="font-medium">Require human approval before code changes</span>
          <span id="human-approval-help" className="mt-1 block leading-snug text-zinc-400">
            When enabled, an approval node must intercept code mutation paths before any code
            change can run.
          </span>
        </span>
      </label>

      {approvalInvalid && (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {
              issues.find(
                (issue) =>
                  issue.code === "MISSING_APPROVAL_GATE" ||
                  issue.code === "APPROVAL_GATE_BYPASS",
              )?.message
            }
          </span>
        </p>
      )}
    </section>
  );
}

export function EvaluatorOptimizerForm({ agentNodes }: { agentNodes: WorkflowNode[] }) {
  const definition = useWorkflowStore((state) => state.definition);
  const agents = useWorkflowStore((state) => state.agents);
  const updateSupervisorConfig = useWorkflowStore((state) => state.updateSupervisorConfig);
  const canEdit = useCanEditArchetype();
  const eo = definition.archetypeConfig?.evaluatorOptimizer;
  const maxIterations = eo?.maxIterations ?? 3;
  const exhaustionOutcome = eo?.exhaustionOutcome ?? "exit_path";
  const generatorId = eo?.generatorNodeIds?.[0] ?? "";
  const evaluatorId = eo?.evaluatorNodeIds?.[0] ?? "";

  return (
    <PanelSection title="Evaluator-Optimizer" aria-label="Evaluator-optimizer settings">
      <label className="block space-y-1.5">
        <span className={labelClass}>Generator agent</span>
        <select
          disabled={!canEdit}
          style={selectChevronStyle()}
          className={cn(selectClass, "disabled:cursor-not-allowed disabled:opacity-50")}
          value={generatorId}
          onChange={(event) =>
            updateSupervisorConfig({
              evaluatorOptimizer: {
                generatorNodeIds: event.target.value ? [event.target.value] : [],
                evaluatorNodeIds: eo?.evaluatorNodeIds ?? [],
                maxIterations,
                passBranch: eo?.passBranch ?? "pass",
                failBranch: eo?.failBranch ?? "fail",
                exhaustionOutcome,
                exhaustionBranch: eo?.exhaustionBranch ?? "exhausted",
              },
            })
          }
        >
          <option value="">Select generator</option>
          {agentNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeLabel(node, agents)}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className={labelClass}>Evaluator agent</span>
        <select
          disabled={!canEdit}
          style={selectChevronStyle()}
          className={cn(selectClass, "disabled:cursor-not-allowed disabled:opacity-50")}
          value={evaluatorId}
          onChange={(event) =>
            updateSupervisorConfig({
              evaluatorOptimizer: {
                generatorNodeIds: eo?.generatorNodeIds ?? [],
                evaluatorNodeIds: event.target.value ? [event.target.value] : [],
                maxIterations,
                passBranch: eo?.passBranch ?? "pass",
                failBranch: eo?.failBranch ?? "fail",
                exhaustionOutcome,
                exhaustionBranch: eo?.exhaustionBranch ?? "exhausted",
              },
            })
          }
        >
          <option value="">Select evaluator</option>
          {agentNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeLabel(node, agents)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1.5">
          <span className={labelClass}>Max loops (1–10)</span>
          <input
            type="number"
            min={1}
            max={10}
            disabled={!canEdit}
            className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
            value={maxIterations}
            onChange={(event) =>
              updateSupervisorConfig({
                evaluatorOptimizer: {
                  generatorNodeIds: eo?.generatorNodeIds ?? [],
                  evaluatorNodeIds: eo?.evaluatorNodeIds ?? [],
                  maxIterations: clampInteger(Number(event.target.value), 1, 10, 3),
                  passBranch: eo?.passBranch ?? "pass",
                  failBranch: eo?.failBranch ?? "fail",
                  exhaustionOutcome,
                  exhaustionBranch: eo?.exhaustionBranch ?? "exhausted",
                },
              })
            }
          />
        </label>

        <label className="block space-y-1.5">
          <span className={labelClass}>On exhaustion</span>
          <select
            disabled={!canEdit}
            style={selectChevronStyle()}
            className={cn(selectClass, "disabled:cursor-not-allowed disabled:opacity-50")}
            value={exhaustionOutcome}
            onChange={(event) =>
              updateSupervisorConfig({
                evaluatorOptimizer: {
                  generatorNodeIds: eo?.generatorNodeIds ?? [],
                  evaluatorNodeIds: eo?.evaluatorNodeIds ?? [],
                  maxIterations,
                  passBranch: eo?.passBranch ?? "pass",
                  failBranch: eo?.failBranch ?? "fail",
                  exhaustionOutcome: event.target.value as "fail" | "exit_path",
                  exhaustionBranch: eo?.exhaustionBranch ?? "exhausted",
                },
              })
            }
          >
            <option value="exit_path">Exit path</option>
            <option value="fail">Fail run</option>
          </select>
        </label>
      </div>
    </PanelSection>
  );
}

const SWARM_BOUNDS_FIELDS = [
  { key: "maxHops", label: "Max peer hops", defaultVal: 10, min: 1, max: 20 },
  { key: "maxDepth", label: "Max call depth", defaultVal: 5, min: 1, max: 20 },
  { key: "maxActivePeerTasks", label: "Max active peer tasks", defaultVal: 4, min: 1, max: 8 },
] as const;

export function AutonomousSwarmForm() {
  const definition = useWorkflowStore((state) => state.definition);
  const updateSupervisorConfig = useWorkflowStore((state) => state.updateSupervisorConfig);
  const canEdit = useCanEditArchetype();
  const swarm = definition.archetypeConfig?.swarm;

  const patch = (partial: Partial<NonNullable<typeof swarm>>) =>
    updateSupervisorConfig({
      swarm: {
        maxHops: swarm?.maxHops ?? 10,
        maxDepth: swarm?.maxDepth ?? 5,
        maxActivePeerTasks: swarm?.maxActivePeerTasks ?? 4,
        ...(swarm?.terminationBranch ? { terminationBranch: swarm.terminationBranch } : {}),
        ...partial,
      },
    });

  return (
    <PanelSection title="Swarm Safety Bounds">
      <div className="space-y-2.5">
        {SWARM_BOUNDS_FIELDS.map((field) => {
          const value = swarm?.[field.key] ?? field.defaultVal;
          return (
            <label key={field.key} className="block space-y-1.5">
              <span className="flex items-center justify-between gap-2">
                <span className={labelClass}>{field.label}</span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {field.min}–{field.max}
                </span>
              </span>
              <input
                type="number"
                min={field.min}
                max={field.max}
                disabled={!canEdit}
                className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
                value={value}
                onChange={(event) =>
                  patch({
                    [field.key]: clampInteger(
                      Number(event.target.value),
                      field.min,
                      field.max,
                      field.defaultVal,
                    ),
                  })
                }
              />
            </label>
          );
        })}
      </div>
    </PanelSection>
  );
}

function nodeLabel(node: WorkflowNode, agents: Array<{ id: string; name: string }>): string {
  const agentId = (node.config as { agentId?: string | null }).agentId;
  const agent = agentId ? agents.find((candidate) => candidate.id === agentId) : undefined;
  return agent?.name ?? node.id;
}

function conditionBranchKeys(nodes: WorkflowNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.type !== "condition") continue;
    const branches = (node.config as { branches?: Array<{ key?: string }> }).branches ?? [];
    for (const branch of branches) {
      if (branch.key && !keys.includes(branch.key)) keys.push(branch.key);
    }
  }
  return keys;
}

function fallbackOptions(branchKeys: string[], current: string): string[] {
  const options = [...branchKeys];
  if (current && !options.includes(current)) options.unshift(current);
  if (options.length === 0) options.push("loop_limit_exceeded");
  return options;
}

export { FOCUS_TARGETS };
