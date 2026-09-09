"use client";

import { create } from "zustand";
import {
  AgentRecord,
  CreateEdgeInput,
  ToolRecord,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowPosition,
  createEdge,
  createEmptyDefinition,
  createNode,
  nowIso,
} from "@/lib/workflow/types";
import { validateWorkflow, WorkflowIssue } from "@/lib/workflow/validation";
import { workflowService } from "@/services/workflowService";
import { assertNoCredentials, removeAgentNodes, removeToolNodes } from "@multi-agent/types";

/** Imperative helpers registered by the canvas (React Flow instance). */
export interface FlowHelpers {
  getCanvasCenter: () => WorkflowPosition;
  fitView: () => void;
  setCenter: (x: number, y: number, zoom?: number) => void;
}

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

const HISTORY_LIMIT = 50;
const CONFIG_EDIT_COALESCE_MS = 900;

function clone(definition: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
}

interface WorkflowStoreState {
  definition: WorkflowDefinition;
  agents: AgentRecord[];
  tools: ToolRecord[];
  loadState: LoadState;
  loadError: string | null;
  isDirty: boolean;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: string | null;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  issues: WorkflowIssue[];
  undoStack: WorkflowDefinition[];
  redoStack: WorkflowDefinition[];
  lastEditKey: { key: string; at: number } | null;
  flowHelpers: FlowHelpers | null;

  // lifecycle
  loadWorkflow: (workflowId?: string) => Promise<void>;
  saveWorkflow: () => Promise<void>;
  setWorkflowName: (name: string) => void;
  setFlowHelpers: (helpers: FlowHelpers) => void;

  // structure
  addNode: (
    type: WorkflowNodeType,
    position?: WorkflowPosition,
    options?: { agentId?: string }
  ) => void;
  addAgentAndNode: (position?: WorkflowPosition) => Promise<void>;
  addNodeForAgent: (agentId: string, position?: WorkflowPosition) => void;
  addToolAndNode: (position?: WorkflowPosition) => Promise<void>;
  addNodeForTool: (toolId: string, position?: WorkflowPosition) => void;
  moveNodes: (positions: Map<string, WorkflowPosition>) => void;
  removeNodes: (nodeIds: string[]) => void;
  removeEdges: (edgeIds: string[]) => void;
  addEdge: (connection: { source: string; target: string; sourceHandle?: string | null }) => void;
  updateNodeConfig: (nodeId: string, patch: Record<string, unknown>) => void;
  updateEdge: (edgeId: string, patch: Partial<Omit<WorkflowEdge, "id">>) => void;
  updateAgentRecord: (
    agentId: string,
    patch: Partial<Omit<AgentRecord, "id" | "createdAt">>
  ) => void;
  deleteAgent: (agentId: string) => Promise<void>;
  updateToolRecord: (
    toolId: string,
    patch: Partial<Omit<ToolRecord, "id" | "createdAt">>
  ) => void;
  deleteTool: (toolId: string) => Promise<void>;

  // history
  beginHistory: () => void;
  undo: () => void;
  redo: () => void;

  // selection
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  selectNodeOnly: (nodeId: string | null) => void;
  selectEdgeOnly: (edgeId: string | null) => void;
  focusIssue: (issue: WorkflowIssue) => void;
  clearSelection: () => void;
}

export const useWorkflowStore = create<WorkflowStoreState>()((set, get) => {
  /** Apply a definition mutation, recompute validation, prune selection. */
  const withDefinition = (
    mutator: (draft: WorkflowDefinition) => void,
    options?: { keepSelection?: boolean }
  ) => {
    set((state) => {
      const draft = clone(state.definition);
      mutator(draft);
      try { assertNoCredentials(draft); } catch (error) {
        return { saveError: error instanceof Error ? error.message : "Credentials are not allowed in workflow data." };
      }
      const issues = validateWorkflow(draft, state.agents, state.tools);
      const nodeIds = new Set(draft.nodes.map((n) => n.id));
      const edgeIds = new Set(draft.edges.map((e) => e.id));
      return {
        definition: draft,
        isDirty: true,
        issues,
        selectedNodeIds: options?.keepSelection
          ? state.selectedNodeIds.filter((id) => nodeIds.has(id))
          : [],
        selectedEdgeIds: options?.keepSelection
          ? state.selectedEdgeIds.filter((id) => edgeIds.has(id))
          : [],
      };
    });
  };

  const pushHistory = () => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), clone(state.definition)],
      redoStack: [],
      lastEditKey: null,
    }));
  };

  /** Push a history snapshot unless it belongs to the same rapid edit burst. */
  const pushHistoryCoalesced = (key: string) => {
    const { lastEditKey } = get();
    const now = Date.now();
    if (lastEditKey && lastEditKey.key === key && now - lastEditKey.at < CONFIG_EDIT_COALESCE_MS) {
      set({ lastEditKey: { key, at: now } });
      return;
    }
    set({
      lastEditKey: { key, at: now },
      undoStack: [...get().undoStack.slice(-(HISTORY_LIMIT - 1)), clone(get().definition)],
      redoStack: [],
    });
  };

  return {
    definition: createEmptyDefinition(),
    agents: [],
    tools: [],
    loadState: "loading",
    loadError: null,
    isDirty: false,
    saveState: "idle",
    saveError: null,
    lastSavedAt: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    issues: [],
    undoStack: [],
    redoStack: [],
    lastEditKey: null,
    flowHelpers: null,

    loadWorkflow: async (workflowId) => {
      set({ loadState: "loading", loadError: null });
      try {
        const [storedDefinition, agents, tools] = await Promise.all([
          workflowService.getWorkflow(workflowId),
          workflowService.listAgents(),
          workflowService.listTools(),
        ]);
        if (workflowId && !storedDefinition) throw new Error("Workflow not found.");
        const definition = storedDefinition ?? createEmptyDefinition();
        set({
          definition,
          agents,
          tools,
          loadState: "ready",
          isDirty: false,
          saveState: "idle",
          saveError: null,
          issues: validateWorkflow(definition, agents, tools),
          selectedNodeIds: [],
          selectedEdgeIds: [],
          undoStack: [],
          redoStack: [],
        });
      } catch (err) {
        set({
          loadState: "error",
          loadError: err instanceof Error ? err.message : "Failed to load workflow",
        });
      }
    },

    saveWorkflow: async () => {
      const { definition } = get();
      set({ saveState: "saving", saveError: null });
      try {
        const saved = await workflowService.saveWorkflow(definition);
        set({ saveState: "saved", lastSavedAt: saved.updatedAt, isDirty: false });
      } catch (err) {
        set({
          saveState: "error",
          saveError: err instanceof Error ? err.message : "Failed to save workflow",
        });
      }
    },

    setWorkflowName: (name) => {
      try { assertNoCredentials(name); } catch (error) { set({ saveError: String(error) }); return; }
      pushHistoryCoalesced("workflow-name");
      set((state) => ({ definition: { ...state.definition, name }, isDirty: true }));
    },

    setFlowHelpers: (helpers) => set({ flowHelpers: helpers }),

    addNode: (type, position, options) => {
      pushHistory();
      const pos =
        position ??
        get().flowHelpers?.getCanvasCenter() ??
        { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 };
      const node = createNode(type, pos, options);
      withDefinition((draft) => {
        draft.nodes.push(node);
      });
      set({ selectedNodeIds: [node.id], selectedEdgeIds: [] });
    },

    addAgentAndNode: async (position) => {
      pushHistory();
      const agent = await workflowService
        .createAgent({ name: "New Agent" })
        .catch(() => null);
      if (!agent) {
        set({ saveError: "Failed to create agent" });
        return;
      }
      const pos =
        position ??
        get().flowHelpers?.getCanvasCenter() ??
        { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 };
      const node = createNode("agent", pos, { agentId: agent.id });
      set((state) => ({ agents: [...state.agents, agent] }));
      withDefinition((draft) => {
        draft.nodes.push(node);
      });
      set({ selectedNodeIds: [node.id], selectedEdgeIds: [] });
    },

    addNodeForAgent: (agentId, position) => {
      pushHistory();
      const pos =
        position ??
        get().flowHelpers?.getCanvasCenter() ??
        { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 };
      const node = createNode("agent", pos, { agentId });
      withDefinition((draft) => {
        draft.nodes.push(node);
      });
      set({ selectedNodeIds: [node.id], selectedEdgeIds: [] });
    },

    addToolAndNode: async (position) => {
      pushHistory();
      const tool = await workflowService
        .createTool({ name: "New Tool" })
        .catch(() => null);
      if (!tool) {
        set({ saveError: "Failed to create tool" });
        return;
      }
      const pos =
        position ??
        get().flowHelpers?.getCanvasCenter() ??
        { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 };
      const node = createNode("tool", pos, { toolId: tool.id });
      set((state) => ({ tools: [...state.tools, tool] }));
      withDefinition((draft) => {
        draft.nodes.push(node);
      });
      set({ selectedNodeIds: [node.id], selectedEdgeIds: [] });
    },

    addNodeForTool: (toolId, position) => {
      pushHistory();
      const pos =
        position ??
        get().flowHelpers?.getCanvasCenter() ??
        { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 };
      const node = createNode("tool", pos, { toolId });
      withDefinition((draft) => {
        draft.nodes.push(node);
      });
      set({ selectedNodeIds: [node.id], selectedEdgeIds: [] });
    },

    moveNodes: (positions) => {
      set((state) => {
        if (positions.size === 0) return state;
        const nodes = state.definition.nodes.map((node) => {
          const position = positions.get(node.id);
          return position
            ? { ...node, position: { x: Math.round(position.x), y: Math.round(position.y) } }
            : node;
        });
        return {
          definition: { ...state.definition, nodes },
          isDirty: true,
        };
      });
    },

    removeNodes: (nodeIds) => {
      if (nodeIds.length === 0) return;
      pushHistory();
      const idSet = new Set(nodeIds);
      // Agent records intentionally survive node deletion — they stay in the
      // registry (palette) until explicitly deleted via deleteAgent.
      withDefinition((draft) => {
        draft.nodes = draft.nodes.filter((n) => !idSet.has(n.id));
        draft.edges = draft.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
      });
    },

    removeEdges: (edgeIds) => {
      if (edgeIds.length === 0) return;
      pushHistory();
      const idSet = new Set(edgeIds);
      withDefinition((draft) => {
        draft.edges = draft.edges.filter((e) => !idSet.has(e.id));
      });
    },

    addEdge: (connection) => {
      const { definition } = get();
      if (!connection.source || !connection.target) return;
      const sourceNode = definition.nodes.find((n) => n.id === connection.source);
      const isCondition = sourceNode?.type === "condition";
      const branchKey = isCondition ? connection.sourceHandle ?? "" : "";
      pushHistory();
      withDefinition((draft) => {
        const input: CreateEdgeInput = {
          source: connection.source,
          target: connection.target,
          kind: isCondition ? "conditional" : "normal",
          branchKey,
        };
        draft.edges.push(createEdge(input));
      });
    },

    updateNodeConfig: (nodeId, patch) => {
      pushHistoryCoalesced(`node:${nodeId}`);
      withDefinition(
        (draft) => {
          const node = draft.nodes.find((n) => n.id === nodeId);
          if (node) {
            node.config = { ...node.config, ...patch } as typeof node.config;
          }
        },
        { keepSelection: true }
      );
    },

    updateEdge: (edgeId, patch) => {
      pushHistoryCoalesced(`edge:${edgeId}`);
      withDefinition(
        (draft) => {
          const edge = draft.edges.find((e) => e.id === edgeId);
          if (edge) {
            Object.assign(edge, patch);
          }
        },
        { keepSelection: true }
      );
    },

    updateAgentRecord: (agentId, patch) => {
      try { assertNoCredentials(patch); } catch (error) {
        set({ saveError: error instanceof Error ? error.message : "Credentials are not allowed in agent data." });
        return;
      }
      pushHistoryCoalesced(`agent:${agentId}`);
      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === agentId ? { ...a, ...patch, updatedAt: nowIso() } : a
        ),
        isDirty: true,
      }));
      const { agents, tools, definition } = get();
      set({ issues: validateWorkflow(definition, agents, tools) });
      const agent = agents.find((a) => a.id === agentId);
      if (agent) {
        const { id: _id, createdAt: _createdAt, ...recordPatch } = agent;
        void _id;
        void _createdAt;
        void workflowService.updateAgent(agentId, recordPatch).catch(() => {
          set({ saveError: "Failed to persist agent changes" });
        });
      }
    },

    deleteAgent: async (agentId) => {
      try { await workflowService.deleteAgent(agentId, { removeReferences: true }); }
      catch (error) { set({ saveError: error instanceof Error ? error.message : "Could not delete agent." }); return; }
      pushHistory();
      withDefinition((draft) => {
        Object.assign(draft, removeAgentNodes(draft, agentId));
      });
      set((state) => {
        const agents = state.agents.filter((a) => a.id !== agentId);
        return { agents, issues: validateWorkflow(state.definition, agents, state.tools), undoStack: [], redoStack: [], lastEditKey: null };
      });
    },

    updateToolRecord: (toolId, patch) => {
      try { assertNoCredentials(patch); } catch (error) {
        set({ saveError: error instanceof Error ? error.message : "Credentials are not allowed in tool data." });
        return;
      }
      pushHistoryCoalesced(`tool:${toolId}`);
      set((state) => ({
        tools: state.tools.map((t) =>
          t.id === toolId ? { ...t, ...patch, updatedAt: nowIso() } : t
        ),
        isDirty: true,
      }));
      const { agents, tools, definition } = get();
      set({ issues: validateWorkflow(definition, agents, tools) });
      const tool = tools.find((t) => t.id === toolId);
      if (tool) {
        const { id: _id, createdAt: _createdAt, ...recordPatch } = tool;
        void _id;
        void _createdAt;
        void workflowService.updateTool(toolId, recordPatch).catch(() => {
          set({ saveError: "Failed to persist tool changes" });
        });
      }
    },

    deleteTool: async (toolId) => {
      try { await workflowService.deleteTool(toolId, { removeReferences: true }); }
      catch (error) { set({ saveError: error instanceof Error ? error.message : "Could not delete tool." }); return; }
      pushHistory();
      withDefinition((draft) => {
        Object.assign(draft, removeToolNodes(draft, toolId));
      });
      set((state) => {
        const tools = state.tools.filter((t) => t.id !== toolId);
        return { tools, issues: validateWorkflow(state.definition, state.agents, tools), undoStack: [], redoStack: [], lastEditKey: null };
      });
    },

    beginHistory: () => {
      pushHistory();
    },

    undo: () => {
      const { undoStack, definition, redoStack } = get();
      if (undoStack.length === 0) return;
      const previous = undoStack[undoStack.length - 1];
      set((state) => ({
        definition: previous,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack.slice(-(HISTORY_LIMIT - 1)), definition],
        isDirty: true,
        issues: validateWorkflow(previous, state.agents, state.tools),
        selectedNodeIds: [],
        selectedEdgeIds: [],
        lastEditKey: null,
      }));
    },

    redo: () => {
      const { redoStack, definition, undoStack } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1];
      set((state) => ({
        definition: next,
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack.slice(-(HISTORY_LIMIT - 1)), definition],
        isDirty: true,
        issues: validateWorkflow(next, state.agents, state.tools),
        selectedNodeIds: [],
        selectedEdgeIds: [],
        lastEditKey: null,
      }));
    },

    setSelection: (nodeIds, edgeIds) => {
      const { selectedNodeIds, selectedEdgeIds } = get();
      const sameNodes =
        nodeIds.length === selectedNodeIds.length &&
        nodeIds.every((id) => selectedNodeIds.includes(id));
      const sameEdges =
        edgeIds.length === selectedEdgeIds.length &&
        edgeIds.every((id) => selectedEdgeIds.includes(id));
      if (sameNodes && sameEdges) return;
      set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
    },

    selectNodeOnly: (nodeId) => {
      set({
        selectedNodeIds: nodeId ? [nodeId] : [],
        selectedEdgeIds: [],
      });
    },

    selectEdgeOnly: (edgeId) => {
      set({
        selectedEdgeIds: edgeId ? [edgeId] : [],
        selectedNodeIds: [],
      });
    },

    focusIssue: (issue) => {
      const { definition, flowHelpers } = get();
      if (issue.edgeId) {
        const edge = definition.edges.find((e) => e.id === issue.edgeId);
        if (edge) {
          const source = definition.nodes.find((n) => n.id === edge.source);
          const target = definition.nodes.find((n) => n.id === edge.target);
          if (source && target) {
            flowHelpers?.setCenter(
              (source.position.x + target.position.x) / 2 + 100,
              (source.position.y + target.position.y) / 2 + 40
            );
          }
        }
        set({ selectedEdgeIds: [issue.edgeId], selectedNodeIds: [] });
        return;
      }
      if (issue.nodeId) {
        const node = definition.nodes.find((n) => n.id === issue.nodeId);
        if (node) {
          flowHelpers?.setCenter(node.position.x + 110, node.position.y + 50);
        }
        set({ selectedNodeIds: [issue.nodeId], selectedEdgeIds: [] });
      }
    },

    clearSelection: () => set({ selectedNodeIds: [], selectedEdgeIds: [] }),
  };
});
