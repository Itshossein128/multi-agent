/**
 * Nested subgraph execution helper (feature 014).
 * Resolves the latest saved child workflow and compiles/invokes it with mapped I/O.
 */
import {
  MAX_SUBGRAPH_DEPTH,
  type AgentRecord,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import type { StudioPrincipal, StudioStore } from "../../../../src/studio/contracts";
import { compileWorkflow, type CompileOptions } from "./workflowCompiler";

export type SubgraphMapping = { source: string; target: string; required?: boolean };

export interface SubgraphRunnerDeps {
  studioStore: StudioStore;
  principal: StudioPrincipal;
  agents: AgentRecord[];
  tools?: ToolRecord[];
  /** Shared compile options forwarded into the nested compile (minus nesting-specific fields). */
  baseOptions?: Omit<CompileOptions, "subgraphRunner" | "nestingDepth">;
}

function readPath(input: unknown, path: string): unknown {
  if (!path || path === "." || path === "input" || path === "$") return input;
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let cursor: unknown = input;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function applyInputMappings(input: unknown, mappings: SubgraphMapping[]): Record<string, unknown> {
  if (!mappings.length) {
    return input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };
  }
  const out: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const value = readPath(input, mapping.source);
    if ((mapping.required !== false) && value === undefined) {
      throw new Error(`Subgraph required input mapping "${mapping.source}" → "${mapping.target}" is missing`);
    }
    out[mapping.target] = value;
  }
  return out;
}

function applyOutputMappings(childOutput: unknown, mappings: SubgraphMapping[]): unknown {
  if (!mappings.length) return childOutput;
  const out: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const value = readPath(childOutput, mapping.source);
    if ((mapping.required !== false) && value === undefined) {
      throw new Error(`Subgraph required output mapping "${mapping.source}" → "${mapping.target}" is missing`);
    }
    out[mapping.target] = value;
  }
  return out;
}

function collectSubgraphRefs(definition: WorkflowDefinition): string[] {
  return definition.nodes
    .filter((node) => node.type === "subgraph")
    .map((node) => String((node.config as { workflowId?: string }).workflowId ?? "").trim())
    .filter(Boolean);
}

async function assertSafeNesting(
  store: StudioStore,
  principal: StudioPrincipal,
  parentId: string,
  childId: string,
  depth: number,
): Promise<WorkflowDefinition> {
  if (depth > MAX_SUBGRAPH_DEPTH) {
    throw new Error(`SUBGRAPH_DEPTH_EXCEEDED: nesting depth ${depth} exceeds max ${MAX_SUBGRAPH_DEPTH}`);
  }
  const child = await store.getWorkflow(childId, principal);
  if (!child) {
    throw new Error(`SUBGRAPH_REF_MISSING: workflow "${childId}" was not found or is inaccessible`);
  }
  if (child.id === parentId) {
    throw new Error(`SUBGRAPH_NESTING_UNSAFE: workflow "${childId}" cannot nest into itself`);
  }
  // Detect reference cycles A→B→A via BFS on subgraph refs (ancestors = parent chain).
  const ancestors = new Set<string>([parentId, childId]);
  const queue = [...collectSubgraphRefs(child)];
  const seen = new Set<string>();
  while (queue.length) {
    const nextId = queue.shift()!;
    if (!nextId || seen.has(nextId)) continue;
    if (ancestors.has(nextId)) {
      throw new Error(`SUBGRAPH_NESTING_UNSAFE: cyclic subgraph reference involving "${nextId}"`);
    }
    seen.add(nextId);
    const nested = await store.getWorkflow(nextId, principal);
    if (nested) queue.push(...collectSubgraphRefs(nested));
  }
  return child;
}

/** Build a CompileOptions.subgraphRunner bound to studio + principal. */
export function createStudioSubgraphRunner(deps: SubgraphRunnerDeps): NonNullable<CompileOptions["subgraphRunner"]> {
  const { studioStore, principal, agents, tools, baseOptions } = deps;
  const runner: NonNullable<CompileOptions["subgraphRunner"]> = async (args) => {
    const child = await assertSafeNesting(
      studioStore,
      principal,
      baseOptions?.workflowId ?? "",
      args.workflowId,
      args.nestingDepth,
    );
    const mappedInput = applyInputMappings(args.input, args.inputMappings);
    const compiled = compileWorkflow(child, agents, {
      ...baseOptions,
      workflowId: child.id,
      tools: tools ?? baseOptions?.tools,
      nestingDepth: args.nestingDepth,
      signal: args.signal ?? baseOptions?.signal,
      // Nested graphs may themselves contain subgraphs.
      subgraphRunner: createStudioSubgraphRunner({
        ...deps,
        baseOptions: { ...baseOptions, workflowId: child.id },
      }),
      // Avoid sharing parent checkpointer thread identity into nested runs.
      runId: baseOptions?.runId ? `${baseOptions.runId}:sub:${args.parentNodeId}` : undefined,
      checkpointer: false,
    });
    const graph = compiled.graph as { invoke: (state: Record<string, unknown>, config?: unknown) => Promise<Record<string, unknown>> };
    const result = await graph.invoke({
      input: mappedInput,
      output: {},
      memory: {},
      workingMemory: {},
      lastValue: mappedInput,
    });
    const childOutput = result.output ?? result.lastValue ?? result;
    return applyOutputMappings(childOutput, args.outputMappings);
  };
  return runner;
}
