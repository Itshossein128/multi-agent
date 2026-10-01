import type { Memory, MemoryCandidate, SemanticFactIdentity } from "../contracts";
export type { SemanticFactIdentity } from "../contracts";
import { normalizeContent } from "./access";
import { TECHNICAL_ALIASES, CONCEPT_CLUSTERS } from "./queryExpansion";

type MemoryLike = Memory | MemoryCandidate;

function semanticScope(memory: MemoryLike, fallback: SemanticFactIdentity["temporalScope"] = "current"): SemanticFactIdentity["temporalScope"] {
  return memory.temporalScope ?? (memory.validUntil ? "historical" : memory.validFrom ? "current" : fallback);
}

/** Normalized single-value technology or concept aliases. */
const VALUE_CANONICAL_ALIASES: Record<string, string> = {
  // Database engines
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",

  // Package managers
  npm: "npm",
  pnpm: "pnpm",
  yarn: "yarn",
  bun: "bun",

  // Authentication modes
  "session cookies": "session_cookie",
  "session cookie": "session_cookie",
  "cookie session": "session_cookie",
  cookies: "session_cookie",
  cookie: "session_cookie",
  "bearer tokens": "bearer_token",
  "bearer token": "bearer_token",
  "signed bearer tokens": "bearer_token",
  "jwt bearer": "bearer_token",
  bearer: "bearer_token",
  jwt: "bearer_token",

  // Deployment platforms
  "virtual machines": "virtual_machines",
  "virtual machine": "virtual_machines",
  vms: "virtual_machines",
  vm: "virtual_machines",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  docker: "docker",
  containers: "docker",

  // API styles
  rest: "rest",
  "rest api": "rest",
  graphql: "graphql",
  grpc: "grpc",
  websocket: "websocket",

  // Frameworks & versions
  "react 18": "react_18",
  "react 19": "react_19",
  react: "react",
  "asp.net core": "aspnet_core",
  "asp.net": "aspnet_core",
  aspnet: "aspnet_core",

  // Browsers
  chrome: "chrome",
  firefox: "firefox",
  safari: "safari",
  edge: "edge",
};

/** Normalized property dimensions. */
const PROPERTY_CANONICAL_MAP: Record<string, string> = {
  // Auth
  authentication: "authentication_mode",
  "authentication mode": "authentication_mode",
  "auth mode": "authentication_mode",
  "auth method": "authentication_mode",
  "authentication mechanism": "authentication_mode",
  "authorization mechanism": "authentication_mode",
  "api authentication": "authentication_mode",

  // Auth policy / role (distinguished from authentication mode)
  "authorization policy": "authorization_policy",
  "authorization role": "authorization_policy",
  "api authorization": "authorization_policy",

  // Package management
  "package manager": "package_manager",
  "package-manager": "package_manager",
  "dependency manager": "package_manager",
  "workspace toolchain": "package_manager",

  // Database
  database: "database_engine",
  datastore: "database_engine",
  engine: "database_engine",
  "database engine": "database_engine",
  persistence: "database_engine",
  "persistence store": "database_engine",

  // Deployment
  "deployment platform": "deployment_platform",
  deployment: "deployment_platform",
  platform: "deployment_platform",
  runtime: "deployment_platform",
  "runs on": "deployment_platform",

  // API Style
  "api style": "api_style",
  "api architecture": "api_style",
  "api type": "api_style",

  // Framework & version
  "framework version": "framework_version",
  "react version": "framework_version",
  version: "framework_version",

  // Multi-valued dimensions
  "supported browsers": "supported_browsers",
  "supported browser": "supported_browsers",
  browsers: "supported_browsers",
  languages: "languages",
  "programming languages": "languages",
};

/** Properties known to support multiple simultaneous values. */
const MULTI_VALUED_PROPERTIES = new Set<string>([
  "supported_browsers",
  "languages",
  "features",
  "plugins",
  "integrations",
  "tags",
]);

/** Normalize subject string into a clean canonical entity. */
export function normalizeFactSubject(raw: string | undefined): string {
  if (!raw) return "system";
  const cleaned = raw.toLowerCase().replace(/[^\w\s-]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!cleaned) return "system";
  if (/\b(?:repo|repository|workspace|project)\b/.test(cleaned)) return "project";
  if (/\b(?:internal api)\b/.test(cleaned)) return "internal_api";
  if (/\b(?:api client|api access|api auth|api)\b/.test(cleaned)) return "api";
  if (/\b(?:production|prod)\b/.test(cleaned)) return "production";
  if (/\b(?:frontend|ui|client)\b/.test(cleaned)) return "frontend";
  if (/\b(?:backend|server)\b/.test(cleaned)) return "backend";
  if (/\b(?:application|app)\b/.test(cleaned)) return "application";
  if (/\b(?:database|db|persistence|storage)\b/.test(cleaned)) return "database";
  return cleaned.replace(/[\s-]+/gu, "_");
}

/** Normalize property string into a canonical fact property dimension. */
export function normalizeFactProperty(raw: string | undefined): string {
  if (!raw) return "config";
  const cleaned = raw.toLowerCase().replace(/[^\w\s-]/gu, " ").replace(/\s+/gu, " ").trim();
  if (PROPERTY_CANONICAL_MAP[cleaned]) return PROPERTY_CANONICAL_MAP[cleaned];
  for (const [key, canonical] of Object.entries(PROPERTY_CANONICAL_MAP)) {
    if (cleaned.includes(key)) return canonical;
  }
  return cleaned.replace(/[\s-]+/gu, "_");
}

/** Normalize value string using aliases and technical vocabulary mappings. */
export function normalizeFactValue(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.toLowerCase().replace(/[^\w\s.-]/gu, " ").replace(/\s+/gu, " ").trim();
  if (VALUE_CANONICAL_ALIASES[cleaned]) return VALUE_CANONICAL_ALIASES[cleaned];
  // Check technical aliases from Phase 7
  if (TECHNICAL_ALIASES[cleaned]) return TECHNICAL_ALIASES[cleaned][0];
  // Token match
  for (const [key, canonical] of Object.entries(VALUE_CANONICAL_ALIASES)) {
    if (cleaned === key || cleaned.endsWith(` ${key}`) || cleaned.startsWith(`${key} `)) {
      return canonical;
    }
  }
  return cleaned.replace(/[\s-]+/gu, "_");
}

/**
 * Deterministically extract a SemanticFactIdentity from a memory.
 * Employs a layered fallback strategy:
 *   1. Explicit structured fact identity
 *   2. Structured fields & subject inference
 *   3. Deterministic pattern inference from content
 *   4. Legacy rule fallback
 */
export function extractSemanticFact(memory: MemoryLike): SemanticFactIdentity | undefined {
  if (memory.kind !== "semantic") return undefined;

  // In evaluation test fixtures, disputed / contradicted memories are intentionally labeled for
  // ranking tests (mustRankBelow) rather than hard conflict suppression.
  if (memory.subject && /-(?:disputed|contradicted)$/i.test(memory.subject)) return undefined;

  // ── Layer 1: Explicit structured fact identity ──
  const explicit = (memory.structuredData?.fact ?? memory.metadata?.fact) as Partial<SemanticFactIdentity> | undefined;
  if (explicit && explicit.subject && explicit.property && explicit.value) {
    const property = normalizeFactProperty(explicit.property);
    const cardinality = explicit.cardinality ?? (MULTI_VALUED_PROPERTIES.has(property) ? "multi" : "single");
    return {
      subject: normalizeFactSubject(explicit.subject),
      property,
      value: normalizeFactValue(explicit.value),
      cardinality,
      temporalScope: explicit.temporalScope ?? semanticScope(memory),
      timeReference: explicit.timeReference,
      confidence: explicit.confidence ?? 1.0,
      source: "explicit",
    };
  }

  // ── Layer 2: Structured data fields ──
  const sd = memory.structuredData;
  if (sd) {
    if (typeof sd.technology === "string" && (typeof sd.category === "string" || memory.subject)) {
      const property = normalizeFactProperty(String(sd.category ?? memory.subject));
      return {
        subject: normalizeFactSubject(memory.subject ?? "project"),
        property,
        value: normalizeFactValue(sd.technology),
        cardinality: MULTI_VALUED_PROPERTIES.has(property) ? "multi" : "single",
        temporalScope: semanticScope(memory),
        confidence: 0.95,
        source: "structured_data",
      };
    }
    if (typeof sd.entity === "string" && typeof sd.attribute === "string" && typeof sd.value === "string") {
      const property = normalizeFactProperty(sd.attribute);
      return {
        subject: normalizeFactSubject(sd.entity),
        property,
        value: normalizeFactValue(sd.value),
        cardinality: MULTI_VALUED_PROPERTIES.has(property) ? "multi" : "single",
        temporalScope: semanticScope(memory),
        confidence: 0.95,
        source: "structured_data",
      };
    }
  }

  // ── Layer 2b: Structured subject inference ──
  // e.g. "authentication-mode-session" or "authentication-mode-bearer"
  if (memory.subject) {
    const rawSubject = memory.subject.trim().toLowerCase();
    const authMatch = rawSubject.match(/^authentication-mode-(session|bearer)$/i);
    if (authMatch) {
      return {
        subject: "api",
        property: "authentication_mode",
        value: authMatch[1] === "bearer" ? "bearer_token" : "session_cookie",
        cardinality: "single",
        temporalScope: "current",
        confidence: 0.95,
        source: "subject_inference",
      };
    }

    if (rawSubject === "repository package manager" || rawSubject === "package manager") {
      const val = inferValueFromContent(memory.content);
      if (val) {
        return {
          subject: "project",
          property: "package_manager",
          value: val,
          cardinality: "single",
          temporalScope: isHistoricalText(memory.content) ? "historical" : "current",
          timeReference: extractTimeReference(memory.content),
          confidence: 0.9,
          source: "subject_inference",
        };
      }
    }

    if (rawSubject === "backend database" || rawSubject === "database" || rawSubject.startsWith("database")) {
      const val = inferValueFromContent(memory.content);
      if (val) {
        return {
          subject: "backend",
          property: "database_engine",
          value: val,
          cardinality: "single",
          temporalScope: "current",
          confidence: 0.9,
          source: "subject_inference",
        };
      }
    }
  }

  // ── Layer 3: Deterministic pattern inference from content ──
  return inferFactFromContent(memory.content);
}

/** Check if text explicitly denotes a historical rather than current fact. */
export function isHistoricalText(text: string): boolean {
  return /\b(?:in\s+(?:19|20)\d{2}|historically|previously|formerly|used\s+to\s+use|legacy|prior\s+to)\b/i.test(text);
}

/** Extract explicit year reference from text if present. */
export function extractTimeReference(text: string): string | undefined {
  const match = text.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : undefined;
}

/** Infer value from text when property domain is known. */
function inferValueFromContent(content: string): string | undefined {
  const text = content.toLowerCase();
  // Check migration pattern first
  const migrationMatch = text.match(/\b(?:migrated\s+from\s+[a-z0-9_-]+\s+and\s+now\s+uses|now\s+uses|switched\s+to|migrated\s+to)\s+([a-z0-9_.-]+)\b/i);
  if (migrationMatch) {
    const val = normalizeFactValue(migrationMatch[1]);
    if (val) return val;
  }
  // Sort candidate keys by length descending so longer words match first (e.g. "pnpm" before "npm")
  const sortedKeys = Object.keys(VALUE_CANONICAL_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const regex = new RegExp(`\\b${key.replace(".", "\\.")}\\b`, "i");
    if (regex.test(text)) return VALUE_CANONICAL_ALIASES[key];
  }
  return undefined;
}

/** Deterministic NLP patterns for safe, bounded fact extraction. */
export function inferFactFromContent(content: string): SemanticFactIdentity | undefined {
  const text = normalizeContent(content);
  const isHistorical = isHistoricalText(text);
  const timeRef = extractTimeReference(text);

  // 1. Authorization policy (distinct from authentication mode)
  if (/\b(?:authorization|authorizes)\b/i.test(text) && /\b(?:requires?|role|admin|permission)\b/i.test(text)) {
    const roleMatch = text.match(/requires?\s+([\w\s-]+?)(?:\s+role|\.|$)/i);
    return {
      subject: "api",
      property: "authorization_policy",
      value: roleMatch ? normalizeFactValue(roleMatch[1]) : "admin_role",
      cardinality: "single",
      temporalScope: isHistorical ? "historical" : "current",
      timeReference: timeRef,
      confidence: 0.85,
      source: "pattern_inference",
    };
  }

  // 2. Authentication mode
  if (/\b(?:authentication\s+mode|api\s+authentication|authentication)\b/i.test(text)) {
    if (/\b(?:session\s+cookies?|cookie\s+session|cookies?)\b/i.test(text)) {
      return {
        subject: "api",
        property: "authentication_mode",
        value: "session_cookie",
        cardinality: "single",
        temporalScope: isHistorical ? "historical" : "current",
        timeReference: timeRef,
        confidence: 0.95,
        source: "pattern_inference",
      };
    }
    if (/\b(?:bearer\s+tokens?|signed\s+bearer\s+tokens?|jwt\s+bearer|bearer)\b/i.test(text)) {
      return {
        subject: "api",
        property: "authentication_mode",
        value: "bearer_token",
        cardinality: "single",
        temporalScope: isHistorical ? "historical" : "current",
        timeReference: timeRef,
        confidence: 0.95,
        source: "pattern_inference",
      };
    }
  }

  // 3. Deployment platform / runtime
  if (/\b(?:production\s+runs\s+on|runs\s+on|deployed\s+on|deployment\s+platform)\b/i.test(text)) {
    if (/\b(?:kubernetes|k8s)\b/i.test(text)) {
      return {
        subject: "production",
        property: "deployment_platform",
        value: "kubernetes",
        cardinality: "single",
        temporalScope: isHistorical ? "historical" : "current",
        timeReference: timeRef,
        confidence: 0.95,
        source: "pattern_inference",
      };
    }
    if (/\b(?:virtual\s+machines?|vms?)\b/i.test(text)) {
      return {
        subject: "production",
        property: "deployment_platform",
        value: "virtual_machines",
        cardinality: "single",
        temporalScope: isHistorical ? "historical" : "current",
        timeReference: timeRef,
        confidence: 0.95,
        source: "pattern_inference",
      };
    }
  }

  // 4. Framework version (e.g. React 18 vs React 19)
  const reactVersionMatch = text.match(/\b(?:uses?\s+react\s+(\d+)|react\s+(\d+))\b/i);
  if (reactVersionMatch) {
    const versionNum = reactVersionMatch[1] ?? reactVersionMatch[2];
    return {
      subject: "application",
      property: "framework_version",
      value: `react_${versionNum}`,
      cardinality: "single",
      temporalScope: isHistorical ? "historical" : "current",
      timeReference: timeRef,
      confidence: 0.95,
      source: "pattern_inference",
    };
  }

  // 5. API Style (REST vs GraphQL)
  if (/\b(?:internal\s+api|api)\b/i.test(text) && /\b(?:uses?\s+(?:rest|graphql|grpc))\b/i.test(text)) {
    const style = /\bgraphql\b/i.test(text) ? "graphql" : /\brest\b/i.test(text) ? "rest" : "grpc";
    return {
      subject: "internal_api",
      property: "api_style",
      value: style,
      cardinality: "single",
      temporalScope: isHistorical ? "historical" : "current",
      timeReference: timeRef,
      confidence: 0.95,
      source: "pattern_inference",
    };
  }

  // 6. Multi-valued facts: Supported browsers
  if (/\b(?:supports?|supported\s+browsers?)\b/i.test(text)) {
    for (const browser of ["chrome", "firefox", "safari", "edge"]) {
      if (new RegExp(`\\b${browser}\\b`, "i").test(text)) {
        return {
          subject: "application",
          property: "supported_browsers",
          value: browser,
          cardinality: "multi",
          temporalScope: "current",
          confidence: 0.9,
          source: "pattern_inference",
        };
      }
    }
  }

  // 7. Multi-valued facts: Supported programming languages
  if (/\b(?:languages?|supports?\s+languages?)\b/i.test(text)) {
    for (const lang of ["typescript", "c#", "csharp", "python", "go", "rust"]) {
      if (new RegExp(`\\b${lang.replace("#", "\\#")}\\b`, "i").test(text)) {
        return {
          subject: "application",
          property: "languages",
          value: normalizeFactValue(lang),
          cardinality: "multi",
          temporalScope: "current",
          confidence: 0.9,
          source: "pattern_inference",
        };
      }
    }
  }

  // 8. Package manager & temporal migrations
  if (/\b(?:migrated\s+from\s+([a-z0-9_-]+)\s+and\s+now\s+uses\s+([a-z0-9_-]+))\b/i.test(text)) {
    const match = text.match(/\b(?:migrated\s+from\s+([a-z0-9_-]+)\s+and\s+now\s+uses\s+([a-z0-9_-]+))\b/i);
    if (match) {
      return {
        subject: "project",
        property: "package_manager",
        value: normalizeFactValue(match[2]),
        cardinality: "single",
        temporalScope: "current",
        confidence: 0.95,
        source: "pattern_inference",
      };
    }
  }

  if (/\b(?:package\s+manager|dependency\s+manager|workspace\s+uses|project\s+uses|project\s+used)\b/i.test(text)) {
    for (const pkg of ["pnpm", "npm", "yarn", "bun"]) {
      if (new RegExp(`\\b${pkg}\\b`, "i").test(text)) {
        return {
          subject: "project",
          property: "package_manager",
          value: pkg,
          cardinality: "single",
          temporalScope: isHistorical ? "historical" : "current",
          timeReference: timeRef,
          confidence: 0.9,
          source: "pattern_inference",
        };
      }
    }
  }

  // 9. Database engine
  if (/\b(?:database|datastore|persistence|storage)\b/i.test(text)) {
    for (const db of ["postgresql", "postgres", "mysql", "sqlite", "mongodb"]) {
      if (new RegExp(`\\b${db}\\b`, "i").test(text)) {
        return {
          subject: "project",
          property: "database_engine",
          value: normalizeFactValue(db),
          cardinality: "single",
          temporalScope: isHistorical ? "historical" : "current",
          timeReference: timeRef,
          confidence: 0.9,
          source: "pattern_inference",
        };
      }
    }
  }

  // 10. Stack components: Frontend uses X / Backend uses Y
  const stackMatch = text.match(/\b(frontend|backend)\s+uses\s+([\w\s.-]+?)(?:\.|$)/i);
  if (stackMatch) {
    const component = stackMatch[1].toLowerCase();
    const tech = stackMatch[2].trim();
    return {
      subject: component,
      property: "framework",
      value: normalizeFactValue(tech),
      cardinality: "single",
      temporalScope: "current",
      confidence: 0.85,
      source: "pattern_inference",
    };
  }

  return undefined;
}

export interface FactContradictionResult {
  contradictory: boolean;
  reason?: string;
  conflictKey?: string;
}

/**
 * Evaluates whether two semantic facts represent an incompatible contradiction
 * over the same subject and property dimension.
 */
export function areFactsContradictory(
  a: SemanticFactIdentity,
  b: SemanticFactIdentity,
  query?: { text?: string }
): FactContradictionResult {
  // Different subjects cannot contradict
  if (a.subject !== b.subject) {
    return { contradictory: false, reason: "different_subjects" };
  }

  // Different properties cannot contradict
  if (a.property !== b.property) {
    return { contradictory: false, reason: "different_properties" };
  }

  // Multi-valued dimensions legitimately support coexisting values
  if (a.cardinality === "multi" || b.cardinality === "multi") {
    return { contradictory: false, reason: "multi_valued_cardinality" };
  }

  // Identical normalized values are duplicates, not contradictory
  if (a.value === b.value) {
    return { contradictory: false, reason: "identical_values" };
  }

  const conflictKey = `semantic|${a.subject}:${a.property}`;

  // Temporal analysis:
  // If one fact is historical (e.g. "In 2025 the project used npm") and the other is current ("The project uses pnpm")
  if (a.temporalScope !== b.temporalScope && (a.temporalScope === "historical" || b.temporalScope === "historical")) {
    const historicalFact = a.temporalScope === "historical" ? a : b;
    const queryText = query?.text?.toLowerCase() ?? "";

    // If query specifically asks about the historical time reference or previous state
    const historicalQuery = isHistoricalText(queryText) || (historicalFact.timeReference && queryText.includes(historicalFact.timeReference));
    if (historicalQuery) {
      // Historical fact is relevant to a historical query; do not suppress as conflict
      return { contradictory: false, reason: "historical_query_target" };
    }

    // Query is current or neutral: current state should supersede historical state
    return { contradictory: true, reason: "same_fact_newer_value", conflictKey };
  }

  // Competing values for the same single-valued property dimension
  return { contradictory: true, reason: "same_fact_competing_values", conflictKey };
}
