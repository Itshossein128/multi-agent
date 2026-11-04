/**
 * Frontend workflow validation.
 *
 * Catches obviously invalid or suspicious workflows before they reach the
 * backend. Cycles are allowed (loops are a first-class LangGraph concept),
 * but cycles without an exit condition produce warnings. The backend must
 * still perform authoritative validation before compiling to LangGraph.
 */

import {
  AgentNodeConfig,
  AgentRecord,
  ApprovalNodeConfig,
  ConditionNodeConfig,
  MemoryNodeConfig,
  ToolNodeConfig,
  ToolRecord,
  WorkflowDefinition,
  agentHasConfiguredModel,
  validateRawNodeContract,
} from "./types";
import { resolveWorkflowArchetype, validateAgent, validateAgentNodeStepConfig, type WorkflowNode } from "@multi-agent/types";

export interface WorkflowIssue {
  id: string;
  /** Stable machine-readable reason; the server enforces the same codes. */
  code?: string;
  severity: "error" | "warning" | "info";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

interface IssueBuilder {
  (message: string, target?: { nodeId?: string; edgeId?: string }, code?: string): WorkflowIssue;
}

function issueFactory(severity: WorkflowIssue["severity"], counter: { n: number }): IssueBuilder {
  return (message, target, code) => ({
    id: `issue-${severity}-${counter.n++}`,
    code,
    severity,
    message,
    nodeId: target?.nodeId,
    edgeId: target?.edgeId,
  });
}

/**
 * Tarjan's algorithm — strongly connected components over the edge graph.
 * Components with more than one node represent cycles; self-loops are
 * handled separately as warnings.
 */
function findCycles(def: WorkflowDefinition): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of def.nodes) adjacency.set(node.id, []);
  for (const edge of def.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const indexByNode = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  const strongConnect = (nodeId: string) => {
    indexByNode.set(nodeId, counter);
    lowlink.set(nodeId, counter);
    counter += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!indexByNode.has(next)) {
        strongConnect(next);
        lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, lowlink.get(next)!));
      } else if (onStack.has(next)) {
        lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, indexByNode.get(next)!));
      }
    }

    if (lowlink.get(nodeId) === indexByNode.get(nodeId)) {
      const component: string[] = [];
      let popped: string;
      do {
        popped = stack.pop()!;
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== nodeId);
      if (component.length > 1) cycles.push(component);
    }
  };

  for (const node of def.nodes) {
    if (!indexByNode.has(node.id)) strongConnect(node.id);
  }
  return cycles;
}

export function validateWorkflow(def: WorkflowDefinition, agents: AgentRecord[], tools: ToolRecord[] = []): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const error = issueFactory("error", { n: 0 });
  const warning = issueFactory("warning", { n: 0 });
  const info = issueFactory("info", { n: 0 });

  if (!def || typeof def !== "object" || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) {
    return [error("Workflow definition must contain nodes and edges arrays")];
  }

  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));

  // -- Structural integrity -------------------------------------------------
  const seenIds = new Set<string>();
  for (const node of def.nodes) {
    if (seenIds.has(node.id)) {
      issues.push(error(`Duplicate node id "${node.id}"`, { nodeId: node.id }));
    }
    seenIds.add(node.id);
  }

  const seenEdgeIds = new Set<string>();
  const seenEdgeKeys = new Set<string>();
  for (const edge of def.edges) {
    if (!edge.id?.trim()) issues.push(error("Edge id is required", { edgeId: edge.id }));
    if (seenEdgeIds.has(edge.id)) issues.push(error(`Duplicate edge id "${edge.id}"`, { edgeId: edge.id }));
    seenEdgeIds.add(edge.id);
    if (edge.kind !== "normal" && edge.kind !== "conditional") {
      issues.push(error("Edge kind must be normal or conditional", { edgeId: edge.id }));
    }
    const edgeKey = `${edge.source}\u0000${edge.target}\u0000${edge.kind}\u0000${edge.branchKey}`;
    if (seenEdgeKeys.has(edgeKey)) issues.push(error("Duplicate edge connection", { edgeId: edge.id }));
    seenEdgeKeys.add(edgeKey);
    if (!nodesById.has(edge.source)) {
      issues.push(error(`Edge references missing source node "${edge.source}"`, { edgeId: edge.id }));
      continue;
    }
    if (!nodesById.has(edge.target)) {
      issues.push(error(`Edge references missing target node "${edge.target}"`, { edgeId: edge.id }));
      continue;
    }
    if (edge.source === edge.target) {
      issues.push(error("Self-referential edges are not supported", { edgeId: edge.id, nodeId: edge.source }));
    }
    if (edge.kind === "conditional") {
      const sourceNode = nodesById.get(edge.source);
      if (sourceNode && sourceNode.type !== "condition" && sourceNode.type !== "approval") {
        issues.push(
          warning("Conditional edges should originate from a Condition or Approval node", {
            edgeId: edge.id,
            nodeId: edge.source,
          })
        );
      }
      if (sourceNode?.type === "approval" && edge.branchKey && !["approved", "rejected"].includes(edge.branchKey)) {
        issues.push(
          warning('Approval branch keys must be "approved" or "rejected"', {
            edgeId: edge.id,
            nodeId: edge.source,
          })
        );
      }
      if (!edge.branchKey.trim()) {
        issues.push(error("Conditional edge is missing a branch key", { edgeId: edge.id }));
      }
    }
  }

  // -- Node configuration ---------------------------------------------------
  for (const node of def.nodes) {
    // Node contracts are validated with the same stable codes the server
    // enforces on save — this assists authoring but never replaces the server.
    for (const contractIssue of validateRawNodeContract(node.contract)) {
      issues.push(
        error(
          contractIssue.field ? `${contractIssue.message} (${contractIssue.field})` : contractIssue.message,
          { nodeId: node.id },
          contractIssue.code,
        )
      );
    }
    switch (node.type) {
      case "agent": {
        const config = node.config as AgentNodeConfig;
        const agent = config.agentId ? agents.find((a) => a.id === config.agentId) : undefined;
        if (!config.agentId || !agent) {
          issues.push(error("Agent node is not linked to an agent", { nodeId: node.id }, "MISSING_AGENT_CONFIG"));
        } else {
          if (agent.enabled === false) {
            issues.push(error(`Agent "${agent.name}" is disabled`, { nodeId: node.id }, "AGENT_DISABLED"));
          }
          for (const message of validateAgent(agent)) issues.push(error(message, { nodeId: node.id }));
          if (!agent.name.trim()) {
            issues.push(error(`Agent "${agent.id}" has no name`, { nodeId: node.id }));
          }
          if (!agentHasConfiguredModel(agent)) {
            const detail =
              agent.backend.type === "cli"
                ? "has no CLI provider configured"
                : "has no model configured";
            issues.push(error(`Agent "${agent.name}" ${detail}`, { nodeId: node.id }));
          }
          if (!agent.systemPrompt.trim()) {
            issues.push(warning(`Agent "${agent.name}" has no system prompt`, { nodeId: node.id }));
          }
          for (const stepIssue of validateAgentNodeStepConfig({
            agent,
            nodeConfig: config,
            registryTools: tools,
          })) {
            issues.push(error(stepIssue.message, { nodeId: node.id }, stepIssue.code));
          }
        }
        break;
      }
      case "tool": {
        const config = node.config as ToolNodeConfig;
        const tool = config.toolId ? tools.find((t) => t.id === config.toolId) : undefined;
        if (!config.toolId || !tool) {
          issues.push(error("Tool node is not linked to a tool", { nodeId: node.id }));
        } else if (tool.enabled === false) {
          issues.push(warning(`Tool "${tool.name}" is disabled`, { nodeId: node.id }));
        }
        break;
      }
      case "approval": {
        const config = node.config as ApprovalNodeConfig;
        if (!config.message.trim()) {
          issues.push(error("Approval node has no approval message", { nodeId: node.id }));
        }
        if (config.approvalType === "timeout" && config.timeoutSeconds <= 0) {
          issues.push(
            error("Approval timeout must be greater than zero seconds", { nodeId: node.id })
          );
        }
        break;
      }
      case "memory": {
        const config = node.config as MemoryNodeConfig;
        if (!config.key.trim()) {
          issues.push(error("Memory node has no memory key", { nodeId: node.id }));
        }
        break;
      }
      case "condition": {
        const config = node.config as ConditionNodeConfig;
        const outgoing = def.edges.filter((e) => e.source === node.id);
        if (config.branches.length < 2) {
          issues.push(warning("Condition node defines fewer than two branches", { nodeId: node.id }));
        }
        if (config.valueSource !== undefined && !["input", "last_value"].includes(String(config.valueSource))) {
          issues.push(error("Condition branch source must be input or last_value", { nodeId: node.id }, "INVALID_CONDITION_SOURCE"));
        }
        if (config.valueField !== undefined && (typeof config.valueField !== "string" || !config.valueField.trim() || config.valueField.length > 100)) {
          issues.push(error("Condition result field must be a non-empty field name of at most 100 characters", { nodeId: node.id }, "INVALID_CONDITION_FIELD"));
        }
        const keys = new Set(config.branches.map((b) => b.key));
        if (keys.size !== config.branches.length) {
          issues.push(error("Condition node has duplicate branch keys", { nodeId: node.id }, "DUPLICATE_BRANCH_KEY"));
        }
        const lowered = new Map<string, string[]>();
        for (const branch of config.branches) {
          if (!branch.key.trim()) continue;
          const lower = branch.key.trim().toLowerCase();
          lowered.set(lower, [...(lowered.get(lower) ?? []), branch.key]);
        }
        for (const duplicates of lowered.values()) {
          if (duplicates.length > 1) {
            issues.push(error(`Branch keys ${duplicates.map((key) => `"${key}"`).join(", ")} collide case-insensitively`, { nodeId: node.id }, "AMBIGUOUS_BRANCH_KEY"));
          }
        }
        for (const [field, code, label] of [["unknownRoute", "INVALID_UNKNOWN_ROUTE", "Unknown"], ["errorRoute", "INVALID_ERROR_ROUTE", "Error"]] as const) {
          const route = config[field];
          if (route === undefined || route === null) continue;
          if (typeof route !== "string" || !route.trim() || !keys.has(route)) {
            issues.push(error(`${label} route must name one of the declared branches`, { nodeId: node.id }, code));
          } else if (!outgoing.some((e) => e.kind === "conditional" && e.branchKey === route)) {
            issues.push(error(`${label} route must have an outgoing conditional edge`, { nodeId: node.id }, code));
          }
        }
        for (const branch of config.branches) {
          if (!branch.key.trim()) {
            issues.push(error("Condition branch has an empty key", { nodeId: node.id }));
          } else if (!outgoing.some((e) => e.kind === "conditional" && e.branchKey === branch.key)) {
            issues.push(warning(`Branch "${branch.key}" has no outgoing edge`, { nodeId: node.id }));
          }
        }
        for (const edge of outgoing) {
          if (edge.kind === "conditional" && edge.branchKey && !keys.has(edge.branchKey)) {
            issues.push(
              warning(`Edge branch "${edge.branchKey}" is not defined on the Condition node`, {
                edgeId: edge.id,
                nodeId: node.id,
              })
            );
          }
        }
        break;
      }
      case "input":
      case "output":
        break;
    }
  }

  // -- Entry / exit points ----------------------------------------------------
  const inputNodes = def.nodes.filter((n) => n.type === "input");
  const outputNodes = def.nodes.filter((n) => n.type === "output");

  if (def.nodes.length === 0) {
    issues.push(
      info("Canvas is empty — drag node types from the palette to start building")
    );
  } else {
    if (inputNodes.length === 0) {
      issues.push(error("Workflow has no Input node (required entry point)"));
    } else if (inputNodes.length > 1) {
      issues.push(error("Workflow must have exactly one Input node"));
    }
    if (outputNodes.length === 0) {
      issues.push(warning("Workflow has no Output node"));
    }
  }

  for (const input of inputNodes) {
    if (def.edges.some((e) => e.target === input.id)) {
      issues.push(warning("Input node should not have incoming edges", { nodeId: input.id }));
    }
  }
  for (const output of outputNodes) {
    if (def.edges.some((e) => e.source === output.id)) {
      issues.push(warning("Output node should not have outgoing edges", { nodeId: output.id }));
    }
  }

  // -- Reachability -----------------------------------------------------------
  if (inputNodes.length === 1) {
    const adjacency = new Map<string, string[]>();
    for (const node of def.nodes) adjacency.set(node.id, []);
    for (const edge of def.edges) {
      if (nodesById.has(edge.target)) adjacency.get(edge.source)?.push(edge.target);
    }
    const reachable = new Set<string>([inputNodes[0].id]);
    const queue = [inputNodes[0].id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    for (const node of def.nodes) {
      if (!reachable.has(node.id)) {
        issues.push(
          warning(`"${nodeLabel(node, agents, tools)}" is not reachable from the Input node`, {
            nodeId: node.id,
          })
        );
      }
    }
  }

  // -- Archetype parity with the server compiler ---------------------------
  issues.push(...validateArchetype(def, nodesById, archetypeCycleNodes(def, nodesById)));

  // -- Cycles -----------------------------------------------------------------
  const exitCapableTypes = new Set(["condition", "approval"]);
  for (const cycle of findCycles(def)) {
    const hasExit = cycle.some((nodeId) => {
      const node = nodesById.get(nodeId);
      return node ? exitCapableTypes.has(node.type) : false;
    });
    const names = cycle.map((id) => nodeLabel(nodesById.get(id)!, agents, tools)).join(" → ");
    issues.push(
      warning(`Cycle ${names} will be bounded by the server recursion limit`, {
        nodeId: cycle[0],
      })
    );
    if (!hasExit) {
      issues.push(
        warning(`Cycle ${names} has no Condition or Approval node and may loop forever`, {
          nodeId: cycle[0],
        })
      );
    }
  }

  return issues;
}

/**
 * Client port of `apps/server/src/compiler/validation.ts` archetype rules.
 * Issue codes and messages match the server so the editor and Run gate agree
 * with save/compile without a network round-trip.
 */
function validateArchetype(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNode>,
  cycleNodes: Set<string>,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  let sequence = 0;
  const add = (code: string, message: string, nodeId?: string, edgeId?: string, severity: WorkflowIssue["severity"] = "error") => {
    issues.push({ id: `issue-${severity}-${code}-${sequence++}`, code, severity, message, nodeId, edgeId });
  };

  if (definition.archetype !== undefined && definition.archetype !== "linear-pipeline" && definition.archetype !== "hierarchical-supervisor") {
    add("INVALID_ARCHETYPE", `Unknown workflow archetype "${String(definition.archetype)}". Allowed archetypes are "linear-pipeline" and "hierarchical-supervisor".`);
  }

  if (definition.archetypeConfig?.category !== undefined && definition.archetypeConfig.category !== "linear-pipeline" && definition.archetypeConfig.category !== "hierarchical-supervisor") {
    add("INVALID_ARCHETYPE", `Unknown archetypeConfig category "${String(definition.archetypeConfig.category)}". Allowed categories are "linear-pipeline" and "hierarchical-supervisor".`);
  }

  const configuredCategory = definition.archetypeConfig?.category;
  if (definition.archetype !== undefined && configuredCategory !== undefined && definition.archetype !== configuredCategory) {
    add("INVALID_ARCHETYPE", "Workflow archetype must match archetypeConfig.category.");
    return issues;
  }

  const archetype = resolveWorkflowArchetype(definition);
  // Untyped legacy graphs retain their existing server-wide cycle limit.
  if (archetype === "linear-pipeline" && (definition.archetype !== undefined || configuredCategory !== undefined)) {
    for (const nodeId of cycleNodes) {
      add("LINEAR_PIPELINE_CYCLE_FORBIDDEN", `Linear pipeline workflows cannot contain cycles. Node "${nodeId}" is part of a cycle.`, nodeId);
    }
  }

  if (archetype === "hierarchical-supervisor") {
    const hubId = definition.archetypeConfig?.supervisorHubNodeId;
    if (!hubId) {
      add("MISSING_SUPERVISOR_HUB", "Hierarchical supervisor workflow requires 'supervisorHubNodeId' in archetypeConfig.");
    } else {
      const hubNode = nodes.get(hubId);
      if (!hubNode || hubNode.type !== "agent") {
        add("INVALID_SUPERVISOR_HUB", `Supervisor hub node "${hubId}" must exist and be an agent node.`, hubId);
      }
    }

    if (!definition.nodes.some((node) => node.type === "condition")) {
      add("MISSING_ROUTING_NODES", "Hierarchical supervisor workflow requires at least one condition routing node.");
    }

    const guards = definition.archetypeConfig?.recursionGuards;
    const cyclicBranchKeys = collectCyclicBranchKeys(definition, cycleNodes);
    if (cycleNodes.size > 0 && (!guards || guards.length === 0)) {
      add("UNGUARDED_CYCLE", "Hierarchical supervisor workflow contains cycles but has no recursion guards configured.");
    } else if (cycleNodes.size > 0 && guards && guards.length > 0) {
      const hasApplicableGuard = guards.some((guard) => {
        const destination = typeof guard.routeKey === "string" ? guard.routeKey.split("->").pop()?.trim() : undefined;
        return Boolean(destination && cyclicBranchKeys.has(destination));
      });
      if (!hasApplicableGuard) {
        add("UNGUARDED_CYCLE", `Hierarchical supervisor workflow contains cycles but no recursion guard matches a cyclic route (${[...cyclicBranchKeys].join(", ") || "unknown"}).`);
      }
    }

    if (definition.archetypeConfig?.humanApprovalGateRequired) {
      const approvalIds = new Set(definition.nodes.filter((node) => node.type === "approval").map((node) => node.id));
      if (approvalIds.size === 0) {
        add("MISSING_APPROVAL_GATE", "A human approval gate is required before any code modification.");
      }
      for (const edge of definition.edges) {
        if (edge.kind === "conditional" && edge.branchKey === "implement_spec" && !approvalIds.has(edge.target)) {
          add("APPROVAL_GATE_BYPASS", `Route "implement_spec" must enter the human approval gate before code changes. It currently targets "${edge.target}".`, edge.target, edge.id);
        }
      }
    }

    if (guards && Array.isArray(guards)) {
      const conditionNodes = definition.nodes.filter((node) => node.type === "condition");
      for (const guard of guards) {
        if (!guard.routeKey || typeof guard.routeKey !== "string" || !guard.routeKey.trim()) {
          add("INVALID_RECURSION_GUARD", "Recursion guard must specify a valid routeKey.");
        }
        if (typeof guard.maxIterations !== "number" || !Number.isInteger(guard.maxIterations) || guard.maxIterations < 1 || guard.maxIterations > 10) {
          add("INVALID_RECURSION_GUARD", `Recursion guard for route "${guard.routeKey ?? "unknown"}" has invalid maxIterations ${String(guard.maxIterations)}. Must be an integer between 1 and 10.`);
        }
        if (!guard.fallbackBranch || typeof guard.fallbackBranch !== "string" || !guard.fallbackBranch.trim()) {
          add("INVALID_RECURSION_GUARD", `Recursion guard for route "${guard.routeKey ?? "unknown"}" must specify a fallbackBranch.`);
          continue;
        }
        const fallbackBranch = guard.fallbackBranch.trim();
        const fallbackDeclared = conditionNodes.some((node) => {
          const branches = (node.config as { branches?: Array<{ key?: string }> }).branches ?? [];
          return branches.some((branch) => branch.key === fallbackBranch);
        });
        if (!fallbackDeclared) {
          add("FALLBACK_NOT_WIRED", `Recursion guard for route "${guard.routeKey}" declares fallbackBranch "${fallbackBranch}" that is not present on any condition node.`);
          continue;
        }
        const fallbackEdge = definition.edges.find((edge) => edge.kind === "conditional" && edge.branchKey === fallbackBranch);
        if (!fallbackEdge) {
          add("FALLBACK_NOT_WIRED", `Recursion guard for route "${guard.routeKey}" fallbackBranch "${fallbackBranch}" has no conditional edge.`);
          continue;
        }
        if (!canReachTerminalExit(definition, nodes, fallbackEdge.target)) {
          add("FALLBACK_NOT_WIRED", `Recursion guard for route "${guard.routeKey}" fallbackBranch "${fallbackBranch}" must reach an output/exit node.`, fallbackEdge.target, fallbackEdge.id);
        }
      }
    }
  }

  return issues;
}

function archetypeCycleNodes(definition: WorkflowDefinition, nodes: Map<string, WorkflowNode>): Set<string> {
  const stack: string[] = [];
  const visited = new Set<string>();
  const cycleNodes = new Set<string>();
  const walk = (id: string) => {
    const cycleStart = stack.indexOf(id);
    if (cycleStart >= 0) {
      for (const nodeId of stack.slice(cycleStart)) cycleNodes.add(nodeId);
      return;
    }
    if (visited.has(id)) return;
    stack.push(id);
    for (const edge of definition.edges.filter((candidate) => candidate.source === id && nodes.has(candidate.target))) walk(edge.target);
    stack.pop();
    visited.add(id);
  };
  for (const node of definition.nodes) walk(node.id);
  return cycleNodes;
}

function collectCyclicBranchKeys(definition: WorkflowDefinition, cycleNodes: Set<string>): Set<string> {
  const keys = new Set<string>();
  if (cycleNodes.size === 0) return keys;
  for (const edge of definition.edges) {
    if (edge.kind !== "conditional" || !edge.branchKey) continue;
    if (canReachAny(definition, edge.target, cycleNodes)) keys.add(edge.branchKey);
  }
  return keys;
}

function canReachAny(definition: WorkflowDefinition, startId: string, targets: Set<string>): boolean {
  const visiting = new Set<string>();
  const walk = (id: string): boolean => {
    if (targets.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const edge of definition.edges.filter((candidate) => candidate.source === id)) {
      if (walk(edge.target)) return true;
    }
    return false;
  };
  return walk(startId);
}

function canReachTerminalExit(definition: WorkflowDefinition, nodes: Map<string, WorkflowNode>, startId: string): boolean {
  const visiting = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return false;
    const node = nodes.get(id);
    if (!node) return false;
    if (node.type === "output") return true;
    visiting.add(id);
    for (const edge of definition.edges.filter((candidate) => candidate.source === id)) {
      if (walk(edge.target)) {
        visiting.delete(id);
        return true;
      }
    }
    visiting.delete(id);
    return false;
  };
  return walk(startId);
}

function nodeLabel(node: WorkflowDefinition["nodes"][number], agents: AgentRecord[], tools: ToolRecord[]): string {
  switch (node.type) {
    case "agent": {
      const config = node.config as AgentNodeConfig;
      const agent = agents.find((a) => a.id === config.agentId);
      return agent?.name ?? "Agent node";
    }
    case "tool": {
      const config = node.config as ToolNodeConfig;
      const tool = tools.find((t) => t.id === config.toolId);
      return tool?.name ?? "Tool node";
    }
    default:
      return node.type;
  }
}
