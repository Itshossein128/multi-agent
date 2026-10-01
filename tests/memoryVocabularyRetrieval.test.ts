import {
  HybridMemoryRetriever,
  DefaultMemoryQueryExpander,
  tokenizeAndNormalize,
  normalizeGrammarToken,
  TECHNICAL_ALIASES,
  CONCEPT_CLUSTERS,
  extractMemoryStructuredTokens,
  evaluateMemoryMatch,
  embeddableMemoryText,
} from "../src/memory/application";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import type { Memory, MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";

const now = Date.parse("2026-09-26T00:00:00Z");
const namespace: MemoryNamespace = { scope: "project", id: "vocab-project" };
const otherNamespace: MemoryNamespace = { scope: "project", id: "other-project" };

const access: MemoryAccessContext = {
  principalId: "test-user",
  tenantId: "tenant-a",
  readableNamespaces: [namespace],
  writableNamespaces: [namespace],
};

function createMemory(id: string, content: string, patch: Partial<Memory> = {}): Memory {
  return {
    id,
    tenantId: "tenant-a",
    namespace,
    kind: "semantic",
    visibility: "shared",
    content,
    importance: 0.8,
    confidence: 0.9,
    source: { type: "user" },
    status: "active",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    contentHash: id,
    version: 1,
    ...patch,
  };
}

async function setupRetriever(memories: Memory[]) {
  const store = new InMemoryMemoryStore(() => new Date(now));
  for (const m of memories) await store.insert(m);
  const retriever = new HybridMemoryRetriever(store, { now: () => now });
  return { store, retriever };
}

describe("Phase 7: Vocabulary-Aware Retrieval and Query Expansion", () => {
  describe("Tokenization and normalization", () => {
    test("preserves technical identifiers while splitting compound tokens", () => {
      const tokens = tokenizeAndNormalize("database-postgresql NextAuth_v5 k8s/cluster");
      expect(tokens).toContain("database");
      expect(tokens).toContain("postgresql");
      expect(tokens).toContain("database-postgresql");
      expect(tokens).toContain("k8s");
    });

    test("performs safe plural/singular normalization without destroying technical terms", () => {
      expect(normalizeGrammarToken("containers")).toBe("container");
      expect(normalizeGrammarToken("dependencies")).toBe("dependency");
      expect(normalizeGrammarToken("requests")).toBe("request");
      expect(normalizeGrammarToken("tokens")).toBe("token");
      expect(normalizeGrammarToken("migrations")).toBe("migration");
      expect(normalizeGrammarToken("databases")).toBe("database");

      // Protected terms must not be corrupted
      expect(normalizeGrammarToken("postgres")).toBe("postgres");
      expect(normalizeGrammarToken("status")).toBe("status");
      expect(normalizeGrammarToken("redis")).toBe("redis");
      expect(normalizeGrammarToken("express")).toBe("express");
      expect(normalizeGrammarToken("k8s")).toBe("k8s");
      expect(normalizeGrammarToken("pnpm")).toBe("pnpm");
    });
  });

  describe("Technical aliases and concept clusters", () => {
    test("centralized alias map covers database, runtime, package, and auth aliases", () => {
      expect(TECHNICAL_ALIASES["postgresql"]).toContain("postgres");
      expect(TECHNICAL_ALIASES["docker"]).toContain("container");
      expect(TECHNICAL_ALIASES["pnpm"]).toContain("package manager");
      expect(TECHNICAL_ALIASES["auth"]).toContain("authorization");
    });

    test("concept clusters map related terms across vocabulary boundaries", () => {
      const persistence = CONCEPT_CLUSTERS.find(c => c.id === "relational-persistence");
      expect(persistence).toBeDefined();
      expect(persistence?.terms).toContain("datastore");
      expect(persistence?.terms).toContain("postgresql");
      expect(persistence?.terms).toContain("database");
      expect(persistence?.terms).toContain("persistence");
    });

    test("DefaultMemoryQueryExpander produces bounded search terms", () => {
      const expander = new DefaultMemoryQueryExpander();
      const expanded = expander.expand("What relational datastore backs persistence?");
      expect(expanded.queryWords.has("relational")).toBe(true);
      expect(expanded.queryWords.has("datastore")).toBe(true);
      expect(expanded.queryWords.has("persistence")).toBe(true);
      expect(expanded.concepts.has("database")).toBe(true);
      expect(expanded.concepts.has("postgresql")).toBe(true);
      expect(expanded.searchTerms.length).toBeLessThanOrEqual(12);
      expect(expanded.searchTerms).toContain("relational");
    });
  });

  describe("Structured signal extraction", () => {
    test("extracts tokens from structured fields, structuredData, and metadata", () => {
      const mem = createMemory("mem-struct", "General note", {
        subject: "database-cluster",
        trigger: "migration failure",
        title: "Database incident",
        structuredData: {
          technology: "PostgreSQL",
          category: "persistence",
        },
        metadata: {
          tags: ["production", "rdbms"],
        },
      });

      const tokens = extractMemoryStructuredTokens(mem);
      expect(tokens.has("database")).toBe(true);
      expect(tokens.has("postgresql")).toBe(true);
      expect(tokens.has("persistence")).toBe(true);
      expect(tokens.has("migration")).toBe(true);
      expect(tokens.has("rdbms")).toBe(true);
    });
  });

  describe("Scenario A: PostgreSQL fact with vocabulary mismatch", () => {
    test("recalls PostgreSQL fact for 'What relational datastore backs persistence?'", async () => {
      const pgMemory = createMemory("bench-sem-postgres", "The repository uses PostgreSQL.", {
        subject: "database-postgresql",
        structuredData: { technology: "PostgreSQL", category: "persistence" },
      });
      const { retriever } = await setupRetriever([pgMemory]);

      const result = await retriever.retrieve({
        text: "What relational datastore backs persistence?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(1);
      const selected = result.results[0];
      expect(selected.memory.id).toBe("bench-sem-postgres");
      expect(selected.scores.structured).toBeGreaterThan(0);
      expect(selected.matchReasons).toBeDefined();
      expect(selected.matchReasons?.some(r => r === "alias_match" || r === "expanded_term_match" || r === "structured_match")).toBe(true);
    });
  });

  describe("Scenario B: Authentication fact with authorization phrasing", () => {
    test("recalls bearer tokens fact for 'How are API requests authorized?'", async () => {
      const authMemory = createMemory("bench-sem-auth", "Authentication uses signed bearer tokens.", {
        subject: "authentication-bearer-tokens",
      });
      const { retriever } = await setupRetriever([authMemory]);

      const result = await retriever.retrieve({
        text: "How are API requests authorized?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].memory.id).toBe("bench-sem-auth");
      expect(result.results[0].matchReasons).toContain("alias_match");
    });
  });

  describe("Scenario C: Package Management with dependency manager phrasing", () => {
    test("recalls pnpm memory for 'Which dependency manager should I use?'", async () => {
      const pnpmMemory = createMemory("bench-sem-pnpm", "The workspace uses pnpm.", {
        subject: "package-manager-pnpm",
      });
      const { retriever } = await setupRetriever([pnpmMemory]);

      const result = await retriever.retrieve({
        text: "Which dependency manager should I use?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].memory.id).toBe("bench-sem-pnpm");
      expect(result.results[0].matchReasons?.some(r => r === "alias_match" || r === "expanded_term_match")).toBe(true);
    });
  });

  describe("Scenario D: Container Runtime with isolated execution phrasing", () => {
    test("recalls Docker memory for 'Where does isolated agent execution happen?'", async () => {
      const dockerMemory = createMemory("bench-sem-docker", "Workers execute inside Docker containers.", {
        subject: "container-runtime-docker",
      });
      const { retriever } = await setupRetriever([dockerMemory]);

      const result = await retriever.retrieve({
        text: "Where does isolated agent execution happen?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].memory.id).toBe("bench-sem-docker");
      expect(result.results[0].matchReasons?.some(r => r === "alias_match" || r === "expanded_term_match")).toBe(true);
    });
  });

  describe("Scenario E: Negative control and precision preservation", () => {
    test("unrelated Storybook memory is never retrieved for persistence query", async () => {
      const storybook = createMemory("bench-sem-storybook", "The UI uses Storybook for component documentation.", {
        subject: "ui-component-storybook",
      });
      const { retriever } = await setupRetriever([storybook]);

      const result = await retriever.retrieve({
        text: "Which database backs persistence?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(0);
      expect(result.diagnostics.candidates[0].reason).toBe("irrelevant");
    });

    test("novel unrelated task produces completely empty retrieval", async () => {
      const memories = [
        createMemory("mem-pnpm", "The repository uses pnpm.", { subject: "package-manager" }),
        createMemory("mem-pg", "The repository uses PostgreSQL.", { subject: "database" }),
      ];
      const { retriever } = await setupRetriever(memories);

      const result = await retriever.retrieve({
        text: "Calculate the orbital period of the exoplanet.",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(0);
      expect(result.diagnostics.candidates.every(c => c.reason === "irrelevant")).toBe(true);
    });
  });

  describe("Cross-Kind vocabulary mismatch", () => {
    test("retrieves episodic failure memory for schema initialization query", async () => {
      const episode = createMemory("bench-epi-migration", "Situation: database migration deployment failure\nAction: run pending migrations\nResult: success\nLesson: Deployment failed because the migration had not run.", {
        kind: "episodic",
        subject: "database migration deployment failure",
        situation: "database migration deployment failure",
        action: "run pending migrations",
        lesson: "Deployment failed because the migration had not run.",
      });
      const { retriever } = await setupRetriever([episode]);

      const result = await retriever.retrieve({
        text: "Have we seen a schema initialization issue before?",
        namespaces: [namespace],
        kinds: ["episodic"],
      }, access);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].memory.id).toBe("bench-epi-migration");
      expect(result.results[0].matchReasons?.some(r => r === "expanded_term_match" || r === "structured_match")).toBe(true);
    });

    test("retrieves procedural memory for schema upgrade deployment issue query", async () => {
      const procedure = createMemory("bench-proc-migration", "Trigger: database migration failure\nProcedure: apply idempotent schema migration patch", {
        kind: "procedural",
        subject: "database migration failure",
        trigger: "database migration failure",
        procedure: "apply idempotent schema migration patch",
      });
      const { retriever } = await setupRetriever([procedure]);

      const result = await retriever.retrieve({
        text: "schema upgrade broke deployment",
        namespaces: [namespace],
        kinds: ["procedural"],
      }, access);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].memory.id).toBe("bench-proc-migration");
      expect(result.results[0].matchReasons?.some(r => r === "expanded_term_match" || r === "structured_match")).toBe(true);
    });
  });

  describe("Security and Isolation Preservation", () => {
    test("does not leak cross-tenant memories under vocabulary expansion", async () => {
      const crossTenant = createMemory("cross-tenant-pg", "The repository uses PostgreSQL.", {
        tenantId: "tenant-other",
      });
      const store = new InMemoryMemoryStore(() => new Date(now));
      await store.insert(crossTenant);
      const retriever = new HybridMemoryRetriever(store, { now: () => now });

      const result = await retriever.retrieve({
        text: "What relational datastore backs persistence?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(0);

      // Defense-in-depth: if store leaked candidates from another tenant, retriever filters them and logs security violation
      const leakyStore = new InMemoryMemoryStore(() => new Date(now));
      jest.spyOn(leakyStore, "search").mockResolvedValue([crossTenant]);
      const safeRetriever = new HybridMemoryRetriever(leakyStore, { now: () => now });
      const leakedResult = await safeRetriever.retrieve({
        text: "What relational datastore backs persistence?",
        namespaces: [namespace],
      }, access);
      expect(leakedResult.results).toHaveLength(0);
      expect(leakedResult.diagnostics.securityViolations).toBeGreaterThan(0);
    });

    test("does not leak unauthorized namespace memories under vocabulary expansion", async () => {
      const unauthNamespaceMem = createMemory("unauth-pg", "The repository uses PostgreSQL.", {
        namespace: otherNamespace,
      });
      const store = new InMemoryMemoryStore(() => new Date(now));
      await store.insert(unauthNamespaceMem);
      const retriever = new HybridMemoryRetriever(store, { now: () => now });

      const result = await retriever.retrieve({
        text: "What relational datastore backs persistence?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(0);
    });

    test("excludes invalidated memories even when vocabulary strongly matches", async () => {
      const invalidatedMem = createMemory("invalid-pg", "The repository uses PostgreSQL.", {
        subject: "database-postgresql",
        metadata: { __reliability_verification_status: "invalidated" },
      });
      const { retriever } = await setupRetriever([invalidatedMem]);

      const result = await retriever.retrieve({
        text: "What relational datastore backs persistence?",
        namespaces: [namespace],
      }, access);

      expect(result.results).toHaveLength(0);
      expect(result.diagnostics.filteredCounts?.invalidated).toBe(1);
    });
  });

  describe("Backward Compatibility", () => {
    test("embeddableMemoryText embeds raw content for version 1 and structured context for version 2", () => {
      const mem = { content: "Main body", subject: "DB", trigger: "On Error", title: "Incident" };
      expect(embeddableMemoryText(mem, "1")).toBe("Main body");
      expect(embeddableMemoryText(mem, "2")).toBe("Subject: DB\nTrigger: On Error\nTitle: Incident\nMain body");
    });
  });
});
