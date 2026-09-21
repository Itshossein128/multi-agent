import type { ConsolidationBackfillOptions, ConsolidationBackfillResult, ConsolidationDiagnostics, MemoryAccessContext, MemoryNamespace, MemoryStore, MemoryCandidate, MemoryConsolidationJudge } from "../contracts";
import { ConsolidationEngine, type ConsolidationEngineOptions } from "./memoryConsolidationEngine";
import { contentHash, requireNamespaces } from "./access";

export interface ConsolidationBackfillOptionsExtended extends ConsolidationEngineOptions {
  backfillOptions?: ConsolidationBackfillOptions;
}

function createEmptyDiagnostics(): ConsolidationDiagnostics {
  return { candidatesEvaluated: 0, exactDuplicates: 0, semanticCandidates: 0, merged: 0, superseded: 0, ignored: 0, keptSeparate: 0, judgeFailures: 0, latencyMs: 0 };
}

/** Bounded, resumable, idempotent consolidation backfill. */
export class ConsolidationBackfill {
  private readonly engine: ConsolidationEngine;
  private readonly store: MemoryStore;
  private readonly judge: MemoryConsolidationJudge;
  private readonly options: Required<ConsolidationBackfillOptions>;
  constructor(options: ConsolidationBackfillOptionsExtended) {
    this.engine = new ConsolidationEngine(options);
    this.store = options.store;
    this.judge = options.judge ?? new (require("./memoryConsolidationJudge").DeterministicMemoryConsolidationJudge)(options.config);
    this.options = {
      dryRun: options.backfillOptions?.dryRun ?? false,
      batchSize: options.backfillOptions?.batchSize ?? 50,
      limit: options.backfillOptions?.limit ?? 1000,
    };
  }
  async run(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<ConsolidationBackfillResult> {
    requireNamespaces([namespace], access, true);
    const diagnostics = createEmptyDiagnostics();
    const result: ConsolidationBackfillResult = {
      processed: 0, merged: 0, superseded: 0, ignored: 0, keptBoth: 0, errors: 0, diagnostics,
    };
    let offset = 0;
    let hasMore = true;
    while (hasMore && result.processed < this.options.limit) {
      const batchSize = Math.min(this.options.batchSize, this.options.limit - result.processed);
      const batch = await this.store.search({
        tenantId: access.tenantId,
        namespaces: [namespace],
        status: "active",
        includeExpired: false,
        limit: batchSize,
        offset,
      });
      if (!batch.length) { hasMore = false; break; }
      for (const memory of batch) {
        if (result.processed >= this.options.limit) break;
        result.processed++;
        try {
          if (this.options.dryRun) {
            const candidates = await this.discoverCandidatesForDryRun(memory, access);
            if (candidates.length) {
              const incoming: MemoryCandidate = {
                namespace: memory.namespace,
                kind: memory.kind,
                content: memory.content,
                source: memory.source,
              };
              const decision = await this.judge.decide(incoming, candidates);
              switch (decision.type) {
                case "ignore_new": result.ignored++; diagnostics.exactDuplicates++; break;
                case "merge": result.merged++; diagnostics.merged++; break;
                case "supersede": result.superseded++; diagnostics.superseded++; break;
                case "keep_both": result.keptBoth++; diagnostics.keptSeparate++; break;
              }
            } else {
              result.keptBoth++;
              diagnostics.keptSeparate++;
            }
          } else {
            const incoming: MemoryCandidate = {
              namespace: memory.namespace,
              kind: memory.kind,
              content: memory.content,
              source: memory.source,
              importance: memory.importance,
              confidence: memory.confidence,
              subject: memory.subject,
              structuredData: memory.structuredData,
              metadata: memory.metadata,
            };
            const consolidated = await this.engine.consolidateMemory(incoming, access, diagnostics);
            if (consolidated.merged > 0) result.merged += consolidated.merged;
            else if (consolidated.persisted) result.keptBoth++;
            else result.ignored++;
          }
        } catch {
          result.errors++;
        }
      }
      offset += batch.length;
      hasMore = batch.length === batchSize;
    }
    return result;
  }
  private async discoverCandidatesForDryRun(memory: { id: string; tenantId: string; namespace: MemoryNamespace; kind: string; content: string }, access: MemoryAccessContext) {
    return (await this.store.search({
      tenantId: memory.tenantId,
      namespaces: [memory.namespace],
      kinds: [memory.kind as "semantic" | "episodic" | "procedural"],
      status: "active",
      includeExpired: false,
      limit: 50,
    })).filter(m => m.id !== memory.id && m.contentHash !== contentHash(memory.content));
  }
}
