import type { MemoryAccessContext, MemoryConsolidator, MemoryNamespace } from "../contracts";
import { requireNamespaces } from "./access";
/** Explicit optional boundary. Semantic merging requires a separately selected policy. */
export class NoopMemoryConsolidator implements MemoryConsolidator {
  async consolidate(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<{ merged: number }> {
    requireNamespaces([namespace], access, true); return { merged: 0 };
  }
}
