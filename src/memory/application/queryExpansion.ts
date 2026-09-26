import type { Memory } from "@multi-agent/types";
import { normalizeContent } from "./access";

export const STOP_WORDS = new Set(
  "a an and are as at be by for from how i in is it me my of on or our please tell that the this to we what with you about does do uses use which should all was were where have has had been being seen when why who".split(" ")
);

const PROTECTED_TERMS = new Set([
  "postgres", "redis", "status", "express", "kubernetes", "k8s", "pnpm", "npm", "yarn", "bun",
  "js", "ts", "sql", "rdbms", "auth", "authz", "authn", "pass", "process", "access", "docker",
]);

/**
 * Safe singular/plural normalizer for common English technical and operational vocabulary.
 * Avoids aggressive stemming that destroys technical identifiers.
 */
export function normalizeGrammarToken(token: string): string {
  const lower = token.toLowerCase();
  if (PROTECTED_TERMS.has(lower) || lower.length <= 3) return lower;
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ses") && lower.length > 4 && !lower.endsWith("sses")) {
    if (lower.endsWith("bases") || lower.endsWith("cases") || lower.endsWith("phases") || lower.endsWith("releases") || lower.endsWith("responses") || lower.endsWith("uses")) {
      return lower.slice(0, -1);
    }
    return lower.slice(0, -2);
  }
  if (lower.endsWith("xes") || lower.endsWith("ches") || lower.endsWith("shes")) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us") && !lower.endsWith("is")) {
    return lower.slice(0, -1);
  }
  return lower;
}

/**
 * Splits compound tokens (kebab-case, snake_case, camelCase, slashes) into distinct constituent words,
 * while preserving the composite identifier.
 */
export function tokenizeAndNormalize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const normalized = normalizeContent(text);
  // Split into coarse chunks on whitespace and major delimiters
  const rawTokens = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const result: string[] = [];

  for (const token of rawTokens) {
    const clean = token.toLowerCase().replace(/^[-_]+|[-_]+$/g, "");
    if (!clean) continue;
    result.push(clean);

    // Split on hyphens and underscores
    if (clean.includes("-") || clean.includes("_")) {
      const parts = clean.split(/[-_]+/).filter(Boolean);
      for (const part of parts) {
        const normalizedPart = normalizeGrammarToken(part);
        if (normalizedPart) result.push(normalizedPart);
      }
    } else {
      const grammarNormalized = normalizeGrammarToken(clean);
      if (grammarNormalized !== clean) result.push(grammarNormalized);
    }
  }

  return [...new Set(result)].filter(t => !STOP_WORDS.has(t));
}

/**
 * Centralized technical aliases. Bidirectional or canonical alias mapping for tooling,
 * platforms, runtimes, and protocols.
 */
export const TECHNICAL_ALIASES: Record<string, string[]> = {
  // Databases & SQL
  postgresql: ["postgres", "pgsql", "pg", "relational", "database", "datastore"],
  postgres: ["postgresql", "pgsql", "pg", "relational", "database", "datastore"],
  pgsql: ["postgresql", "postgres", "pg"],
  pg: ["postgresql", "postgres", "pgsql"],
  sqlite: ["sqlite3"],
  sqlite3: ["sqlite"],
  mongodb: ["mongo"],
  mongo: ["mongodb"],
  // Languages & runtimes
  javascript: ["js"],
  js: ["javascript"],
  typescript: ["ts"],
  ts: ["typescript"],
  python: ["py"],
  py: ["python"],
  // Infrastructure, containerization & isolation
  kubernetes: ["k8s"],
  k8s: ["kubernetes"],
  docker: ["container", "containers", "runtime", "isolated", "isolation"],
  container: ["docker", "containers", "runtime", "isolated", "isolation"],
  containers: ["docker", "container", "runtime", "isolated", "isolation"],
  sandbox: ["isolated", "isolation", "container"],
  isolated: ["isolation", "container", "sandbox", "docker"],
  isolation: ["isolated", "container", "sandbox", "docker"],
  // Repositories & package managers
  repository: ["repo"],
  repo: ["repository"],
  pnpm: ["package manager", "dependency manager", "dependencies", "dependency"],
  npm: ["package manager", "dependency manager", "dependencies", "dependency"],
  yarn: ["package manager", "dependency manager", "dependencies", "dependency"],
  package: ["pkg", "dependency", "dependencies"],
  pkg: ["package"],
  dependencies: ["deps", "packages", "dependency", "package manager", "dependency manager"],
  dependency: ["dep", "dependencies", "package", "dependency manager", "package manager"],
  dep: ["dependency", "dependencies"],
  deps: ["dependencies", "dependency"],
  // Specifications & configurations
  specification: ["spec", "specs"],
  spec: ["specification", "specs"],
  configuration: ["config", "configs"],
  config: ["configuration", "configs"],
  environment: ["env", "envs"],
  env: ["environment", "envs"],
  documentation: ["doc", "docs"],
  doc: ["documentation", "docs"],
  docs: ["documentation", "doc"],
  // Authentication & authorization
  authentication: ["auth", "authn", "authorization", "authorized", "authorize", "tokens", "bearer"],
  auth: ["authentication", "authorization", "authorized"],
  authorization: ["auth", "authz", "authentication", "authorized", "authorize"],
  authorized: ["authenticated", "authorized", "auth", "authorization", "bearer"],
  authorize: ["authorized", "authorization", "authentication", "auth"],
  authz: ["authorization", "auth"],
  authn: ["authentication", "auth"],
  bearer: ["tokens", "token", "authentication", "authorized", "auth"],
  token: ["bearer", "tokens", "auth", "authentication"],
  tokens: ["bearer", "token", "auth", "authentication"],
  // Migrations & Schema
  migration: ["schema", "schema migration", "database migration", "upgrade"],
  schema: ["migration", "schema migration", "database", "database migration"],
  upgrade: ["migration", "schema upgrade", "schema migration"],
};

export interface ConceptCluster {
  id: string;
  terms: string[];
}

/**
 * Compact, bounded domain concept clusters for explaining and connecting semantically
 * related vocabulary without external ontologies or LLM calls.
 */
export const CONCEPT_CLUSTERS: ConceptCluster[] = [
  {
    id: "relational-persistence",
    terms: [
      "database", "datastore", "persistence", "relational",
      "persistence store", "rdbms", "sql", "postgresql", "postgres",
    ],
  },
  {
    id: "authentication-authorization",
    terms: [
      "authentication", "authorization", "authorized", "authorize",
      "bearer token", "bearer tokens", "signed bearer tokens", "token",
      "tokens", "auth", "credentials", "api requests", "api client",
    ],
  },
  {
    id: "dependency-management",
    terms: [
      "package manager", "dependency manager", "dependencies", "dependency",
      "package", "packages", "pnpm", "npm", "yarn", "workspace",
    ],
  },
  {
    id: "isolated-container-execution",
    terms: [
      "container", "containers", "docker", "isolated", "isolation",
      "sandbox", "execution", "execute", "runtime", "workers", "worker",
    ],
  },
  {
    id: "schema-migration",
    terms: [
      "migration", "schema", "schema initialization", "schema migration",
      "schema upgrade", "database migration", "upgrade", "migration failure",
      "alter table", "idempotent guard",
    ],
  },
  {
    id: "system-failure",
    terms: [
      "failure", "failed", "broken", "broke", "issue", "incident",
      "error", "bug", "crash",
    ],
  },
  {
    id: "service-deployment",
    terms: [
      "deployment", "deploy", "release", "ship", "production",
      "restart", "health check",
    ],
  },
];

export interface ExpandedQuery {
  originalText: string;
  normalizedText: string;
  queryWords: Set<string>;
  expandedTerms: Set<string>;
  aliases: Set<string>;
  concepts: Set<string>;
  searchTerms: string[];
}

export interface MemoryQueryExpander {
  normalize(text: string): string;
  expand(text: string): ExpandedQuery;
}

export class DefaultMemoryQueryExpander implements MemoryQueryExpander {
  normalize(text: string): string {
    return normalizeContent(text);
  }

  expand(text: string): ExpandedQuery {
    const normalizedText = this.normalize(text);
    const queryWords = new Set(tokenizeAndNormalize(text));
    const aliases = new Set<string>();
    const concepts = new Set<string>();
    const expandedTerms = new Set<string>();

    // 1. Technical aliases expansion for each query token
    for (const word of queryWords) {
      const directAliases = TECHNICAL_ALIASES[word];
      if (directAliases) {
        for (const alias of directAliases) {
          for (const token of tokenizeAndNormalize(alias)) {
            if (!queryWords.has(token)) {
              aliases.add(token);
              expandedTerms.add(token);
            }
          }
        }
      }
    }

    // 2. Multi-word phrase matching against aliases (e.g. "package manager", "dependency manager")
    for (const [key, aliasList] of Object.entries(TECHNICAL_ALIASES)) {
      if (key.includes(" ") && normalizedText.includes(key)) {
        for (const alias of aliasList) {
          for (const token of tokenizeAndNormalize(alias)) {
            aliases.add(token);
            expandedTerms.add(token);
          }
        }
      }
    }

    // 3. Domain concept clusters matching
    for (const cluster of CONCEPT_CLUSTERS) {
      let clusterMatched = false;
      for (const term of cluster.terms) {
        if (term.includes(" ")) {
          if (normalizedText.includes(term)) {
            clusterMatched = true;
            break;
          }
        } else if (queryWords.has(term) || queryWords.has(normalizeGrammarToken(term))) {
          clusterMatched = true;
          break;
        }
      }

      if (clusterMatched) {
        for (const term of cluster.terms) {
          for (const token of tokenizeAndNormalize(term)) {
            if (!queryWords.has(token)) {
              concepts.add(token);
              expandedTerms.add(token);
            }
          }
        }
      }
    }

    // 4. Central bounded candidate search terms for storage queries:
    // First original query words, then aliases, then concept words (up to 12 total terms).
    const searchTerms: string[] = [];
    const seen = new Set<string>();
    const addSearchTerm = (term: string) => {
      if (!term || seen.has(term) || STOP_WORDS.has(term)) return;
      seen.add(term);
      searchTerms.push(term);
    };

    for (const word of queryWords) addSearchTerm(word);
    for (const alias of aliases) {
      if (searchTerms.length >= 10) break;
      addSearchTerm(alias);
    }
    for (const concept of concepts) {
      if (searchTerms.length >= 12) break;
      addSearchTerm(concept);
    }

    return {
      originalText: text,
      normalizedText,
      queryWords,
      expandedTerms,
      aliases,
      concepts,
      searchTerms,
    };
  }
}

/**
 * Extracts structured tokens and concepts from memory subject, title, trigger,
 * situation, action, result, lesson, procedure, structuredData, and metadata.
 */
export function extractMemoryStructuredTokens(memory: Memory): Set<string> {
  const tokens = new Set<string>();
  const add = (text: unknown) => {
    if (typeof text !== "string" || !text.trim()) return;
    for (const token of tokenizeAndNormalize(text)) tokens.add(token);
  };

  add(memory.subject);
  add(memory.title);
  add(memory.trigger);
  add(memory.situation);
  add(memory.action);
  add(memory.result);
  add(memory.lesson);
  add(memory.procedure);

  const visit = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === "string") add(item);
        else if (item && typeof item === "object") visit(item);
      }
      return;
    }
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      add(key);
      if (typeof val === "string") add(val);
      else if (Array.isArray(val) || (val && typeof val === "object")) visit(val);
    }
  };

  visit(memory.structuredData);
  visit(memory.metadata);

  return tokens;
}

export interface MemoryMatchEvaluation {
  literalContentOverlap: number;
  effectiveLexicalScore: number;
  structuredScore: number;
  contextScore: number;
  semanticScore: number;
  isRelevant: boolean;
  matchReasons: string[];
}

function computeOverlap(sourceTokens: Set<string>, targetTokens: Set<string>): number {
  if (!sourceTokens.size || !targetTokens.size) return 0;
  let matches = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token) || targetTokens.has(normalizeGrammarToken(token))) {
      matches += 1;
    }
  }
  return matches / sourceTokens.size;
}

/**
 * Evaluates match signals and computes explainable match reasons for a memory candidate.
 */
export function evaluateMemoryMatch(
  query: ExpandedQuery,
  memory: Memory,
  semanticScore: number,
  semanticThreshold: number
): MemoryMatchEvaluation {
  const contentTokens = new Set(tokenizeAndNormalize(memory.content));
  const structuredTokens = extractMemoryStructuredTokens(memory);

  // 1. Literal content match
  const literalContentOverlap = computeOverlap(query.queryWords, contentTokens);

  // 2. Alias & Concept content match
  const aliasContentOverlap = computeOverlap(query.aliases, contentTokens);
  const conceptContentOverlap = computeOverlap(query.concepts, contentTokens);

  // 3. Structured match (subject, trigger, metadata, etc.)
  const structuredExactOverlap = computeOverlap(query.queryWords, structuredTokens);
  const structuredAliasOverlap = computeOverlap(query.aliases, structuredTokens);
  const structuredConceptOverlap = computeOverlap(query.concepts, structuredTokens);

  const structuredExpandedOverlap = Math.max(structuredAliasOverlap, structuredConceptOverlap);
  const structuredScore = Math.max(
    structuredExactOverlap,
    structuredExpandedOverlap > 0 ? 0.7 * structuredExpandedOverlap : 0
  );

  // Legacy context overlap based strictly on literal query tokens
  const contextTokens = new Set([
    ...tokenizeAndNormalize([memory.subject, memory.title, memory.trigger, memory.lesson].filter(Boolean).join(" ")),
  ]);
  const literalContextOverlap = computeOverlap(query.queryWords, contextTokens);
  const contextScore = Math.max(literalContextOverlap, structuredScore);

  // Effective lexical score combining literal and bounded alias/concept signals
  let effectiveLexicalScore = literalContentOverlap;
  if (effectiveLexicalScore === 0) {
    if (aliasContentOverlap > 0) effectiveLexicalScore = Math.min(1, 0.7 * aliasContentOverlap);
    else if (conceptContentOverlap > 0) effectiveLexicalScore = Math.min(1, 0.5 * conceptContentOverlap);
  }

  // Determine explainable match reasons
  const matchReasons: string[] = [];
  if (literalContentOverlap > 0) matchReasons.push("lexical_match");
  if (semanticScore >= Math.max(0.01, semanticThreshold)) matchReasons.push("semantic_match");
  if (structuredExactOverlap > 0 || structuredTokens.size > 0 && structuredExpandedOverlap > 0) {
    matchReasons.push("structured_match");
  }
  if (aliasContentOverlap > 0 || structuredAliasOverlap > 0) {
    matchReasons.push("alias_match");
  }
  if (conceptContentOverlap > 0 || structuredConceptOverlap > 0) {
    matchReasons.push("expanded_term_match");
  }

  const isRelevant =
    literalContentOverlap > 0 ||
    effectiveLexicalScore > 0 ||
    structuredScore > 0 ||
    contextScore > 0 ||
    semanticScore >= Math.max(0.01, semanticThreshold);

  return {
    literalContentOverlap,
    effectiveLexicalScore,
    structuredScore,
    contextScore,
    semanticScore,
    isRelevant,
    matchReasons,
  };
}
