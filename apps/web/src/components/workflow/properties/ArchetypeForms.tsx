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
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "./fields";

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
  const dormant = effective === "linear-pipeline" && Boolean(
    definition.archetypeConfig?.supervisorHubNodeId ||
      (definition.archetypeConfig?.recursionGuards?.length ?? 0) > 0 ||
      definition.archetypeConfig?.evaluatorOptimizer ||
      definition.archetypeConfig?.swarm,
  );
  useFocusOnIssue("archetype-selector", ["INVALID_ARCHETYPE", "LINEAR_PIPELINE_CYCLE_FORBIDDEN"]);

  return (
    <section className="space-y-2" aria-label="Workflow archetype">
      <div className="flex items-center justify-between gap-2">
        <h3 className={labelClass}>Archetype</h3>
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", descriptor.badgeClass)}>
          {descriptor.label}{legacy ? " (Legacy)" : ""}
        </span>
      </div>
      <label className="block space-y-1">
        <span className="sr-only">Active archetype</span>
        <select
          id="archetype-selector"
          aria-label="Active archetype"
          disabled={!canEdit}
          value={effective}
          onChange={(event) => setWorkflowArchetype(event.target.value as WorkflowArchetypeCategory)}
          className={cn(inputClass, "focus-visible:ring-1 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50")}
        >
          {ARCHETYPE_ORDER.map((id) => (
            <option key={id} value={id}>{ARCHETYPE_DESCRIPTORS[id].label}</option>
          ))}
        </select>
      </label>
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-400">
        <p>{descriptor.description}</p>
        <p className="mt-1 text-zinc-500">{descriptor.topologyConstraint}</p>
      </div>
      {legacy && (
        <p role="status" className="text-[11px] text-zinc-400">
          This workflow has no explicit archetype yet. Saving Linear Pipeline or Hierarchical Supervisor promotes it to strict validation.
        </p>
      )}
      {dormant && (
        <p role="status" className="rounded-md border border-blue-500/30 bg-blue-950/40 px-2 py-1.5 text-[11px] text-blue-200">
          Supervisor / evaluator-optimizer / swarm settings are preserved in a dormant state while configured as Linear Pipeline.
        </p>
      )}
    </section>
  );
}

export function SupervisorHubPicker({ agentNodes }: { agentNodes: WorkflowNode[] }) {
  const definition = useWorkflowStore((state) => state.definition);
  const agents = useWorkflowStore((state) => state.agents);
  const updateSupervisorConfig = useWorkflowStore((state) => state.updateSupervisorConfig);
  const issues = useWorkflowStore((state) => state.issues);
  const canEdit = useCanEditArchetype();
  const hubId = definition.archetypeConfig?.supervisorHubNodeId ?? "";
  const hubIssue = issues.find((issue) => issue.code === "INVALID_SUPERVISOR_HUB" || issue.code === "MISSING_SUPERVISOR_HUB");
  const missing = Boolean(hubId) && !agentNodes.some((node) => node.id === hubId);
  useFocusOnIssue("supervisor-hub-select", ["MISSING_SUPERVISOR_HUB", "INVALID_SUPERVISOR_HUB"]);

  return (
    <section className="space-y-2" aria-label="Supervisor hub">
      <label className={labelClass} htmlFor="supervisor-hub-select">Supervisor hub</label>
      <select
        id="supervisor-hub-select"
        aria-label="Supervisor hub"
        aria-invalid={Boolean(hubIssue) || missing}
        aria-describedby={hubIssue || missing ? "supervisor-hub-error" : undefined}
        disabled={!canEdit || agentNodes.length === 0}
        value={agentNodes.some((node) => node.id === hubId) ? hubId : ""}
        onChange={(event) => updateSupervisorConfig({ supervisorHubNodeId: event.target.value })}
        className={cn(
          inputClass,
          "focus-visible:ring-1 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50",
          (hubIssue || missing) && "border-red-500/80 focus-visible:ring-red-500",
        )}
      >
        <option value="">{agentNodes.length === 0 ? "No agent nodes on canvas (add one from palette)" : "Select an agent node"}</option>
        {agentNodes.map((node) => (
          <option key={node.id} value={node.id}>{nodeLabel(node, agents)}</option>
        ))}
      </select>
      {(hubIssue || missing) && (
        <p id="supervisor-hub-error" role="alert" className="text-[11px] text-red-300">
          {missing || hubIssue?.code === "INVALID_SUPERVISOR_HUB"
            ? `Selected hub node missing from canvas or not an agent${hubId ? ` (${hubId})` : ""}.`
            : hubIssue?.message}
        </p>
      )}
    </section>
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
  const guardInvalid = issues.some((issue) => issue.code === "INVALID_RECURSION_GUARD" || issue.code === "FALLBACK_NOT_WIRED" || issue.code === "UNGUARDED_CYCLE");
  useFocusOnIssue("recursion-guards", ["UNGUARDED_CYCLE"]);
  useFocusOnIssue("recursion-guard-route-0", ["INVALID_RECURSION_GUARD"]);
  useFocusOnIssue("recursion-guard-fallback-0", ["FALLBACK_NOT_WIRED"]);

  return (
    <section id="recursion-guards" className="space-y-2" aria-label="Recursion guards" tabIndex={-1}>
      <div className="flex items-center justify-between">
        <h3 className={labelClass}>Recursion guards</h3>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => addRecursionGuard({ routeKey: "feedback_loop", maxIterations: 3, fallbackBranch: "loop_limit_exceeded" })}
          className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
        >
          Add guard
        </button>
      </div>
      {guardInvalid && (
        <p role="alert" className="text-[11px] text-red-300">
          {issues.find((issue) => issue.code === "UNGUARDED_CYCLE" || issue.code === "INVALID_RECURSION_GUARD" || issue.code === "FALLBACK_NOT_WIRED")?.message}
        </p>
      )}
      {guards.length === 0 && <p className="text-[11px] text-zinc-500">No recursion guards configured.</p>}
      <ul className="space-y-2">
        {guards.map((guard, index) => (
          <li key={`${guard.routeKey}-${index}`} className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
            <label className="block space-y-1">
              <span className={labelClass}>Route</span>
              <input
                id={index === 0 ? "recursion-guard-route-0" : undefined}
                aria-label={`Guard ${index + 1} route`}
                disabled={!canEdit}
                value={guard.routeKey}
                onChange={(event) => updateRecursionGuard(index, { routeKey: event.target.value })}
                className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
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
                onChange={(event) => updateRecursionGuard(index, {
                  maxIterations: clampInteger(Number(event.target.value), MIN_RECURSION_ITERATIONS, MAX_RECURSION_ITERATIONS, 3),
                })}
                className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Fallback branch</span>
              <select
                id={index === 0 ? "recursion-guard-fallback-0" : undefined}
                aria-label={`Guard ${index + 1} fallback branch`}
                disabled={!canEdit}
                value={guard.fallbackBranch}
                onChange={(event) => updateRecursionGuard(index, { fallbackBranch: event.target.value })}
                className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
              >
                {fallbackOptions(branchKeys, guard.fallbackBranch).map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={`Delete guard ${index + 1}`}
              disabled={!canEdit}
              onClick={() => removeRecursionGuard(index)}
              className="text-[10px] font-semibold text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete
            </button>
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
  const approvalInvalid = issues.some((issue) => issue.code === "MISSING_APPROVAL_GATE" || issue.code === "APPROVAL_GATE_BYPASS");
  useFocusOnIssue("human-approval-gate", ["MISSING_APPROVAL_GATE", "APPROVAL_GATE_BYPASS"]);
  useFocusOnIssue("max-execution-steps", []);

  return (
    <section id="supervisor-config" className="space-y-3" aria-label="Supervisor execution limits" tabIndex={-1}>
      <label className="block space-y-1">
        <span className={labelClass}>Max execution steps</span>
        <input
          id="max-execution-steps"
          aria-label="Max execution steps"
          type="number"
          min={MIN_EXECUTION_STEPS}
          max={MAX_EXECUTION_STEPS}
          disabled={!canEdit}
          value={steps}
          onChange={(event) => updateSupervisorConfig({
            maxExecutionSteps: clampInteger(Number(event.target.value), MIN_EXECUTION_STEPS, MAX_EXECUTION_STEPS, 1000),
          })}
          className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-indigo-400")}
        />
      </label>
      <label className="flex items-start gap-2 text-[11px] text-zinc-300">
        <input
          id="human-approval-gate"
          aria-label="Require human approval before code changes"
          aria-invalid={approvalInvalid}
          aria-describedby="human-approval-help"
          type="checkbox"
          disabled={!canEdit}
          checked={approvalRequired}
          onChange={(event) => updateSupervisorConfig({ humanApprovalGateRequired: event.target.checked })}
          className="mt-0.5 disabled:cursor-not-allowed"
        />
        <span>
          Require human approval before code changes
          <span id="human-approval-help" className="mt-1 block text-zinc-500">
            When enabled, an approval node must intercept code mutation paths before any code change can run.
          </span>
        </span>
      </label>
      {approvalInvalid && (
        <p role="alert" className="text-[11px] text-red-300">
          {issues.find((issue) => issue.code === "MISSING_APPROVAL_GATE" || issue.code === "APPROVAL_GATE_BYPASS")?.message}
        </p>
      )}
    </section>
  );
}

export function EvaluatorOptimizerForm({ agentNodes }: { agentNodes: WorkflowNode[] }) {
  const definition = useWorkflowStore((state) => state.definition);
  const updateSupervisorConfig = useWorkflowStore((state) => state.updateSupervisorConfig);
  const canEdit = useCanEditArchetype();
  const eo = definition.archetypeConfig?.evaluatorOptimizer;
  const maxIterations = eo?.maxIterations ?? 3;
  const exhaustionOutcome = eo?.exhaustionOutcome ?? "exit_path";
  const generatorId = eo?.generatorNodeIds?.[0] ?? "";
  const evaluatorId = eo?.evaluatorNodeIds?.[0] ?? "";

  return (
    <section className="space-y-2" aria-label="Evaluator-optimizer settings">
      <h3 className={labelClass}>Evaluator-optimizer</h3>
      <label className="block space-y-1 text-[11px] text-zinc-400">
        Generator agent
        <select
          disabled={!canEdit}
          className={inputClass}
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
            <option key={node.id} value={node.id}>{node.id}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-[11px] text-zinc-400">
        Evaluator agent
        <select
          disabled={!canEdit}
          className={inputClass}
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
            <option key={node.id} value={node.id}>{node.id}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-[11px] text-zinc-400">
        Max iterations (1–10)
        <input
          type="number"
          min={1}
          max={10}
          disabled={!canEdit}
          className={inputClass}
          value={maxIterations}
          onChange={(event) =>
            updateSupervisorConfig({
              evaluatorOptimizer: {
                generatorNodeIds: eo?.generatorNodeIds ?? [],
                evaluatorNodeIds: eo?.evaluatorNodeIds ?? [],
                maxIterations: Number(event.target.value),
                passBranch: eo?.passBranch ?? "pass",
                failBranch: eo?.failBranch ?? "fail",
                exhaustionOutcome,
                exhaustionBranch: eo?.exhaustionBranch ?? "exhausted",
              },
            })
          }
        />
      </label>
      <label className="block space-y-1 text-[11px] text-zinc-400">
        Exhaustion outcome
        <select
          disabled={!canEdit}
          className={inputClass}
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
    </section>
  );
}

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
    <section className="space-y-2" aria-label="Autonomous swarm bounds">
      <h3 className={labelClass}>Swarm safety bounds</h3>
      {([
        ["maxHops", swarm?.maxHops ?? 10, 1, 20],
        ["maxDepth", swarm?.maxDepth ?? 5, 1, 20],
        ["maxActivePeerTasks", swarm?.maxActivePeerTasks ?? 4, 1, 8],
      ] as const).map(([key, value, min, max]) => (
        <label key={key} className="block space-y-1 text-[11px] text-zinc-400">
          {key} ({min}–{max})
          <input
            type="number"
            min={min}
            max={max}
            disabled={!canEdit}
            className={inputClass}
            value={value}
            onChange={(event) => patch({ [key]: Number(event.target.value) })}
          />
        </label>
      ))}
    </section>
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
