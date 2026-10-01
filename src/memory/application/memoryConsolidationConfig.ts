import type { ConsolidationConfig } from "../contracts";
import { MemoryValidationError } from "../contracts";

/** Default consolidation thresholds. */
export const DEFAULT_CONSOLIDATION_CONFIG: Required<ConsolidationConfig> = {
  exactDuplicateThreshold: 0.999,
  semanticCandidateThreshold: 0.65,
  autoMergeThreshold: 0.85,
  reviewThreshold: 0.7,
  candidateSearchLimit: 50,
  embeddingSearchLimit: 30,
};

/** Validate and merge user-provided config with defaults. */
export function resolveConsolidationConfig(partial?: ConsolidationConfig): Required<ConsolidationConfig> {
  const config = { ...DEFAULT_CONSOLIDATION_CONFIG, ...partial };
  const entries: [keyof ConsolidationConfig, number][] = [
    ["exactDuplicateThreshold", config.exactDuplicateThreshold],
    ["semanticCandidateThreshold", config.semanticCandidateThreshold],
    ["autoMergeThreshold", config.autoMergeThreshold],
    ["reviewThreshold", config.reviewThreshold],
    ["candidateSearchLimit", config.candidateSearchLimit],
    ["embeddingSearchLimit", config.embeddingSearchLimit],
  ];
  for (const [key, value] of entries) {
    if (!Number.isFinite(value) || value < 0) throw new MemoryValidationError(`Invalid consolidation config: ${key}`);
  }
  if (config.exactDuplicateThreshold > 1) throw new MemoryValidationError("exactDuplicateThreshold must be <= 1");
  if (config.autoMergeThreshold < config.semanticCandidateThreshold) throw new MemoryValidationError("autoMergeThreshold must be >= semanticCandidateThreshold");
  return config;
}
