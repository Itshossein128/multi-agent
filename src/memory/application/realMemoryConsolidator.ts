import type { ConsolidationConfig, ConsolidationResult, MemoryAccessContext, MemoryConsolidator, MemoryNamespace } from "../contracts";
import { requireNamespaces } from "./access";
import { ConsolidationEngine, type ConsolidationEngineOptions } from "./memoryConsolidationEngine";

export interface RealMemoryConsolidatorOptions extends ConsolidationEngineOptions {}

/** Real memory consolidation implementation. */
export class RealMemoryConsolidator implements MemoryConsolidator {
  private readonly engine: ConsolidationEngine;
  constructor(options: RealMemoryConsolidatorOptions) {
    this.engine = new ConsolidationEngine(options);
  }
  async consolidate(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<ConsolidationResult> {
    requireNamespaces([namespace], access, true);
    return this.engine.consolidate(access, namespace);
  }
  /** Expose engine for direct memory consolidation. */
  getEngine(): ConsolidationEngine { return this.engine; }
}
