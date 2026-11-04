/**
 * Pure hierarchical top→bottom layout for Studio Auto-Arrange.
 * Layout only — does not mutate edge semantics or node configs.
 */

export interface AutoArrangeNodeInput {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface AutoArrangeEdgeInput {
  source: string;
  target: string;
}

const RANK_GAP_Y = 140;
const NODE_GAP_X = 220;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

/**
 * Assign layers by longest-path from roots (prefer nodes with no incoming edges).
 * Within each rank, pack left→right. Cycles: ignore back-edges already ranked.
 */
export function computeAutoArrangePositions(
  nodes: ReadonlyArray<AutoArrangeNodeInput>,
  edges: ReadonlyArray<AutoArrangeEdgeInput>,
): Map<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    outgoing.get(edge.source)!.push(edge.target);
    incoming.get(edge.target)!.push(edge.source);
  }

  const rank = new Map<string, number>();
  const roots = ids.filter((id) => (incoming.get(id)?.length ?? 0) === 0);
  const start = roots.length > 0 ? roots : [ids[0]].filter(Boolean);

  // Kahn-like longest-path: iterate until stable or max |V| passes
  for (const id of start) rank.set(id, 0);
  for (let pass = 0; pass < ids.length + 2; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
      const rs = rank.get(edge.source);
      if (rs === undefined) continue;
      const next = rs + 1;
      const rt = rank.get(edge.target);
      if (rt === undefined || next > rt) {
        // Avoid inflating forever on cycles: cap relative to |V|
        if (next > ids.length) continue;
        rank.set(edge.target, next);
        changed = true;
      }
    }
    // Seed any still-unranked nodes
    for (const id of ids) {
      if (!rank.has(id)) {
        rank.set(id, 0);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = rank.get(id) ?? 0;
    const list = byRank.get(r) ?? [];
    list.push(id);
    byRank.set(r, list);
  }

  // Stable order within rank: preserve previous relative x when possible
  const prevX = new Map(nodes.map((n) => [n.id, n.position.x] as const));
  for (const [, list] of byRank) {
    list.sort((a, b) => (prevX.get(a) ?? 0) - (prevX.get(b) ?? 0) || a.localeCompare(b));
  }

  const positions = new Map<string, { x: number; y: number }>();
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of ranks) {
    const list = byRank.get(r) ?? [];
    const rowWidth = Math.max(list.length - 1, 0) * NODE_GAP_X;
    const startX = ORIGIN_X - rowWidth / 2 + (rowWidth === 0 ? 0 : 0);
    // Center around ORIGIN_X + modest offset
    const baseX = ORIGIN_X;
    list.forEach((id, index) => {
      const x = baseX + index * NODE_GAP_X - ((list.length - 1) * NODE_GAP_X) / 2;
      const y = ORIGIN_Y + r * RANK_GAP_Y;
      positions.set(id, { x: Math.round(x), y: Math.round(y) });
    });
    void startX;
  }

  return positions;
}
