import type { MemoryAccessContext, MemoryConsolidator, MemoryNamespace, ConsolidationDiagnostics, ConsolidationResult } from "../contracts";
import { requireNamespaces } from "./access";
/** Explicit optional boundary. Semantic merging requires a separately selected policy. */
export class NoopMemoryConsolidator implements MemoryConsolidator {
  async consolidate(_access: MemoryAccessContext, _namespace: MemoryNamespace): Promise<ConsolidationResult> {
    requireNamespaces([_namespace], _access, true);
    return { merged: 0, diagnostics: { candidatesEvaluated: 0, exactDuplicates: 0, semanticCandidates: 0, merged: 0, superseded: 0, ignored: 0, keptSeparate: 0, judgeFailures: 0, latencyMs: 0 } };
  }
}
