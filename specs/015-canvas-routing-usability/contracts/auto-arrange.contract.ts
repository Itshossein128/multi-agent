/**
 * UI contract: Auto-Arrange toolbar action
 * Feature: 015-canvas-routing-usability
 */

export interface AutoArrangeRequest {
  /** Current node ids and positions before layout. */
  nodes: ReadonlyArray<{ id: string; position: { x: number; y: number }; width?: number; height?: number }>;
  /** Edges used only for ranking/connectivity — not mutated. */
  edges: ReadonlyArray<{ source: string; target: string }>;
}

export interface AutoArrangeResult {
  /** New positions keyed by node id. Every input node SHOULD appear. */
  positions: ReadonlyMap<string, { x: number; y: number }> | Record<string, { x: number; y: number }>;
}

/**
 * Behavioral contract for the Studio editor:
 * - Available from Design-mode toolbar as "Auto-Arrange" (or equivalent label)
 * - Disabled in Live mode
 * - Exactly one history push covering the full position batch (Undo restores prior layout)
 * - MUST NOT add/remove/rewrite nodes, edges, configs, kind, or branchKey
 */
export interface AutoArrangeEditorContract {
  actionId: "auto-arrange";
  modes: { design: true; live: false };
  mutates: { positions: true; topology: false; configs: false; edgeSemantics: false };
  recovery: "undo";
}

export const AUTO_ARRANGE_EDITOR: AutoArrangeEditorContract = {
  actionId: "auto-arrange",
  modes: { design: true, live: false },
  mutates: { positions: true, topology: false, configs: false, edgeSemantics: false },
  recovery: "undo",
};
