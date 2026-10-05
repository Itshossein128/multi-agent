import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { DefaultMemoryService } from "../src/memory/application/memoryService";
import { HybridMemoryRetriever } from "../src/memory/application/hybridMemoryRetriever";
import {
  extractSemanticFact,
  areFactsContradictory,
  normalizeFactSubject,
  normalizeFactProperty,
  normalizeFactValue,
  type SemanticFactIdentity,
} from "../src/memory/application/semanticFact";
import { classifyMemoryRelationship, conflictGroupKey } from "../src/memory/application/memoryConflictStrategy";
import { DeterministicMemoryConsolidationJudge } from "../src/memory/application/memoryConsolidationJudge";
import { ConsolidationEngine } from "../src/memory/application/memoryConsolidationEngine";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { DefaultMemoryExtractor } from "../src/memory/application/memoryExtractor";
import { DefaultMemoryWritePolicy } from "../src/memory/application/memoryWritePolicy";
import { DefaultMemoryContextFormatter } from "../src/memory/application/memoryContextFormatter";
import { DefaultMemoryBackgroundJobs } from "../src/memory/application/memoryBackgroundJobs";
import type { Memory, MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";

const now = Date.parse("2026-09-26T12:00:00.000Z");

const namespace: MemoryNamespace = { scope: "project", id: "conflict-test" };
const otherNamespace: MemoryNamespace = { scope: "project", id: "other-ns" };

const access: MemoryAccessContext = {
  principalId: "test-user",
  tenantId: "tenant-conflict",
  readableNamespaces: [namespace, otherNamespace],
  writableNamespaces: [namespace, otherNamespace],
};

function memoryRecord(id: string, content: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    tenantId: access.tenantId,
    namespace,
    kind: "semantic",
    visibility: "project",
    content,
    importance: 0.8,
    confidence: 0.9,
    status: "active",
    createdAt: new Date(now - 86400000).toISOString(),
    updatedAt: new Date(now - 86400000).toISOString(),
    version: 1,
    contentHash: `hash-${id}`,
    source: { type: "agent", runId: "init-run" },
    ...overrides,
  };
}

describe("Phase 8: Generalized Semantic Conflict Detection and Canonical Fact Selection", () => {
  describe("Semantic Fact Extraction and Normalization", () => {
    test("extracts explicit structured fact identity when provided (Layer 1)", () => {
      const mem = memoryRecord("m1", "Random prose", {
        structuredData: {
          fact: {
            subject: "database",
            property: "engine",
            value: "PostgreSQL",
            cardinality: "single",
          },
        },
      });
      const fact = extractSemanticFact(mem);
      expect(fact).toBeDefined();
      expect(fact!.subject).toBe("database");
      expect(fact!.property).toBe("database_engine");
      expect(fact!.value).toBe("postgresql");
      expect(fact!.cardinality).toBe("single");
      expect(fact!.source).toBe("explicit");
    });

    test("extracts fact from structured fields and subject (Layer 2)", () => {
      const memAuth = memoryRecord("m-auth", "Authentication mode is session cookies.", {
        subject: "authentication-mode-session",
      });
      const factAuth = extractSemanticFact(memAuth);
      expect(factAuth).toBeDefined();
      expect(factAuth!.subject).toBe("api");
      expect(factAuth!.property).toBe("authentication_mode");
      expect(factAuth!.value).toBe("session_cookie");

      const memDb = memoryRecord("m-db", "Storage persistence details", {
        subject: "database",
        structuredData: { technology: "PostgreSQL", category: "persistence" },
      });
      const factDb = extractSemanticFact(memDb);
      expect(factDb).toBeDefined();
      expect(factDb!.property).toBe("database_engine");
      expect(factDb!.value).toBe("postgresql");
    });

    test("extracts fact from deterministic pattern inference (Layer 3)", () => {
      const k8s = memoryRecord("m-k8s", "Production runs on Kubernetes.");
      const factK8s = extractSemanticFact(k8s);
      expect(factK8s).toBeDefined();
      expect(factK8s!.subject).toBe("production");
      expect(factK8s!.property).toBe("deployment_platform");
      expect(factK8s!.value).toBe("kubernetes");

      const react = memoryRecord("m-react", "Application uses React 19.");
      const factReact = extractSemanticFact(react);
      expect(factReact).toBeDefined();
      expect(factReact!.subject).toBe("application");
      expect(factReact!.property).toBe("framework_version");
      expect(factReact!.value).toBe("react_19");

      const graphql = memoryRecord("m-gql", "Internal API uses GraphQL.");
      const factGql = extractSemanticFact(graphql);
      expect(factGql).toBeDefined();
      expect(factGql!.subject).toBe("internal_api");
      expect(factGql!.property).toBe("api_style");
      expect(factGql!.value).toBe("graphql");
    });

    test("distinguishes authentication from authorization policy", () => {
      const auth = memoryRecord("m-auth", "API authentication uses bearer tokens.");
      const authz = memoryRecord("m-authz", "API authorization requires admin role.");

      const factAuth = extractSemanticFact(auth);
      const factAuthz = extractSemanticFact(authz);

      expect(factAuth!.property).toBe("authentication_mode");
      expect(factAuthz!.property).toBe("authorization_policy");

      const check = areFactsContradictory(factAuth!, factAuthz!);
      expect(check.contradictory).toBe(false);
      expect(check.reason).toBe("different_properties");
    });
  });

  describe("Contradiction Semantics and Multi-Valued Facts", () => {
    test("independent domains coexist without contradiction", () => {
      const frontend = memoryRecord("m-fe", "Frontend uses React.", { subject: "frontend" });
      const backend = memoryRecord("m-be", "Backend uses ASP.NET Core.", { subject: "backend" });

      const factFe = extractSemanticFact(frontend);
      const factBe = extractSemanticFact(backend);

      const check = areFactsContradictory(factFe!, factBe!);
      expect(check.contradictory).toBe(false);
      expect(check.reason).toBe("different_subjects");
      expect(classifyMemoryRelationship(frontend, backend)).toBe("independent");
    });

    test("multi-valued facts coexist without contradiction", () => {
      const chrome = memoryRecord("m-chrome", "Application supports Chrome.");
      const firefox = memoryRecord("m-firefox", "Application supports Firefox.");

      const factChrome = extractSemanticFact(chrome);
      const factFirefox = extractSemanticFact(firefox);

      expect(factChrome!.cardinality).toBe("multi");
      expect(factFirefox!.cardinality).toBe("multi");

      const check = areFactsContradictory(factChrome!, factFirefox!);
      expect(check.contradictory).toBe(false);
      expect(check.reason).toBe("multi_valued_cardinality");
      expect(classifyMemoryRelationship(chrome, firefox)).toBe("independent");
    });

    test("temporal facts: historical query preserves past fact; current query selects current fact", () => {
      const hist = memoryRecord("m-hist", "In 2025 the project used npm.");
      const curr = memoryRecord("m-curr", "The project uses pnpm.");

      const factHist = extractSemanticFact(hist);
      const factCurr = extractSemanticFact(curr);

      expect(factHist!.temporalScope).toBe("historical");
      expect(factHist!.timeReference).toBe("2025");
      expect(factCurr!.temporalScope).toBe("current");

      // Historical query: "What package manager did the project use in 2025?"
      const histCheck = areFactsContradictory(factHist!, factCurr!, { text: "What package manager did the project use in 2025?" });
      expect(histCheck.contradictory).toBe(false);
      expect(histCheck.reason).toBe("historical_query_target");

      // Current query: "What package manager does the project use now?"
      const currCheck = areFactsContradictory(factHist!, factCurr!, { text: "What package manager does the project use now?" });
      expect(currCheck.contradictory).toBe(true);
      expect(currCheck.reason).toBe("same_fact_newer_value");
    });
  });

  describe("Benchmark Scenarios A through G", () => {
    let store: InMemoryMemoryStore;
    let service: DefaultMemoryService;
    let retriever: HybridMemoryRetriever;

    beforeEach(() => {
      store = new InMemoryMemoryStore(() => new Date(now));
      retriever = new HybridMemoryRetriever(store, { now: () => now });
      service = new DefaultMemoryService(store, { retriever, now: () => now });
    });

    test("Scenario A: Authentication Mode (bearer tokens wins over stale session cookies)", async () => {
      const stale = memoryRecord("auth-stale", "Authentication mode is session cookies.", {
        subject: "authentication-mode-session",
        metadata: { __reliability_verification_status: "stale" },
      });
      const verified = memoryRecord("auth-verified", "Authentication mode is bearer tokens.", {
        subject: "authentication-mode-bearer",
        metadata: { __reliability_verification_status: "verified" },
      });
      await store.insert(stale);
      await store.insert(verified);

      const res = await service.recall({ text: "Which authentication mode should the API client use?", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(["auth-verified"]);

      const staleCandidate = res.diagnostics.candidates.find(c => c.memoryId === "auth-stale");
      expect(staleCandidate?.dropReason).toBe("conflict_suppressed");
      expect(staleCandidate?.suppressedByMemoryId).toBe("auth-verified");
      expect(staleCandidate?.factSubject).toBe("api");
      expect(staleCandidate?.factProperty).toBe("authentication_mode");
      expect(staleCandidate?.factValue).toBe("session_cookie");
    });

    test("Scenario B: Deployment Platform (Kubernetes wins over stale VMs)", async () => {
      const vm = memoryRecord("vm", "Production runs on virtual machines.", {
        metadata: { __reliability_verification_status: "stale" },
      });
      const k8s = memoryRecord("k8s", "Production runs on Kubernetes.", {
        metadata: { __reliability_verification_status: "verified" },
      });
      await store.insert(vm);
      await store.insert(k8s);

      const res = await service.recall({ text: "Where does production deploy and run?", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(["k8s"]);
      expect(res.diagnostics.conflict?.suppressed).toBe(1);
    });

    test("Scenario C: Framework Version (React 19 wins over stale React 18)", async () => {
      const r18 = memoryRecord("react-18", "Application uses React 18.", {
        metadata: { __reliability_verification_status: "stale" },
      });
      const r19 = memoryRecord("react-19", "Application uses React 19.", {
        metadata: { __reliability_verification_status: "verified" },
      });
      await store.insert(r18);
      await store.insert(r19);

      const res = await service.recall({ text: "Which React version does the application use?", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(["react-19"]);
    });

    test("Scenario D: API Style (GraphQL wins over stale REST)", async () => {
      const rest = memoryRecord("api-rest", "Internal API uses REST.", {
        metadata: { __reliability_verification_status: "stale" },
      });
      const gql = memoryRecord("api-gql", "Internal API uses GraphQL.", {
        metadata: { __reliability_verification_status: "verified" },
      });
      await store.insert(rest);
      await store.insert(gql);

      const res = await service.recall({ text: "What API architecture style is used for internal services?", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(["api-gql"]);
    });

    test("Scenario E: Non-Conflict Multi-Domain (Frontend React and Backend ASP.NET both preserved)", async () => {
      const fe = memoryRecord("fe-react", "Frontend uses React.", { subject: "frontend" });
      const be = memoryRecord("be-aspnet", "Backend uses ASP.NET Core.", { subject: "backend" });
      await store.insert(fe);
      await store.insert(be);

      const res = await service.recall({ text: "What technologies do the frontend and backend use?", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(expect.arrayContaining(["fe-react", "be-aspnet"]));
      expect(res.diagnostics.conflict?.suppressed).toBe(0);
    });

    test("Scenario F: Multi-Valued Fact (Chrome and Firefox both preserved)", async () => {
      const chrome = memoryRecord("br-chrome", "Application supports Chrome.");
      const firefox = memoryRecord("br-firefox", "Application supports Firefox.");
      await store.insert(chrome);
      await store.insert(firefox);

      const res = await service.recall({ text: "Which browsers are supported by the application?", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(expect.arrayContaining(["br-chrome", "br-firefox"]));
      expect(res.diagnostics.conflict?.suppressed).toBe(0);
    });
  });

  describe("Production Runtime & ContextAssembler Integration (Section 25)", () => {
    test("full AgentRuntime and ContextAssembler path suppresses stale conflict while preserving independent facts", async () => {
      const store = new InMemoryMemoryStore(() => new Date(now));

      // Memory A: API auth session cookies (stale)
      const memA = memoryRecord("mem-a", "API authentication uses session cookies.", {
        subject: "api",
        metadata: { __reliability_verification_status: "stale" },
      });
      // Memory B: API auth bearer tokens (verified)
      const memB = memoryRecord("mem-b", "API authentication uses bearer tokens.", {
        subject: "api",
        metadata: { __reliability_verification_status: "verified" },
      });
      // Memory C: API authz requires admin role
      const memC = memoryRecord("mem-c", "API authorization requires admin role.", {
        subject: "api",
        metadata: { __reliability_verification_status: "verified" },
      });
      // Memory D: Frontend uses React
      const memD = memoryRecord("mem-d", "Frontend uses React.", {
        subject: "frontend",
        metadata: { __reliability_verification_status: "verified" },
      });

      await store.insert(memA);
      await store.insert(memB);
      await store.insert(memC);
      await store.insert(memD);

      const retriever = new HybridMemoryRetriever(store, { now: () => now });
      const service = new DefaultMemoryService(store, { retriever, now: () => now });

      const agent = {
        id: "auth-agent",
        name: "Auth Agent",
        role: "assistant",
        description: "Test agent",
        systemPrompt: "You are an assistant.",
        tools: [],
        enabled: true,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        metadata: {},
        backend: { type: "api" as const, provider: "openai" as const, model: "gpt-4" },
        memory: {
          enabled: true,
          type: "run" as const,
          scope: "agent" as const,
          mode: "read" as const,
          maxEntries: 5,
          shortTerm: { enabled: false },
          longTerm: {
            enabled: true,
            readableNamespaces: [namespace],
            writableNamespace: namespace,
            retrieval: { maxTokens: 2048 },
          },
        },
      };

      const capturedInputs: any[] = [];
      const runtime = new AgentRuntime(
        {
          create: () => ({
            async *execute(input: any) {
              capturedInputs.push(input);
              yield {
                type: "agent.completed",
                timestamp: new Date().toISOString(),
                agentId: input.agent.id,
                nodeId: input.nodeId,
                runId: input.runId,
                payload: { content: "Executed successfully" },
              };
            },
          }),
        },
        {
          service,
          extractor: new DefaultMemoryExtractor(),
          writePolicy: new DefaultMemoryWritePolicy(),
          formatter: new DefaultMemoryContextFormatter(),
          jobs: new DefaultMemoryBackgroundJobs(),
        }
      );

      const events: any[] = [];
      for await (const event of runtime.execute({
        agent,
        input: "How is API authentication handled for client requests?",
        runId: "run-auth-test",
        nodeId: "auth-node",
        workflowId: "wf-auth",
        memoryAccess: access,
      })) {
        events.push(event);
      }

      expect(capturedInputs.length).toBe(1);
      const memoryContext = capturedInputs[0].context?.memoryContext ?? "";

      // Memory B (bearer tokens) MUST be included
      expect(memoryContext).toContain("API authentication uses bearer tokens.");
      // Memory A (session cookies) MUST be suppressed
      expect(memoryContext).not.toContain("session cookies");
      // Memory D (Frontend uses React) should not be included for an API authentication query
      expect(memoryContext).not.toContain("Frontend uses React.");
    });
  });

  describe("Production Consolidation Supersession (Section 26 & 27)", () => {
    test("consolidation judge produces supersede decision for temporal migration without hardcoded domain families", async () => {
      const judge = new DeterministicMemoryConsolidationJudge();
      const existing = [
        memoryRecord("old-pkg", "The repository package manager uses npm.", { subject: "repository package manager" }),
      ];
      const incoming = {
        namespace,
        kind: "semantic" as const,
        content: "The repository package manager migrated from npm and now uses pnpm.",
        source: { type: "user" as const },
        subject: "repository package manager",
      };

      const decision = await judge.decide(incoming, existing);
      expect(decision.type).toBe("supersede");
      expect(decision.relatedMemoryIds).toContain("old-pkg");
    });
  });

  describe("Security and Isolation Preservation", () => {
    test("conflict detection never suppresses memories across different tenants", async () => {
      const store = new InMemoryMemoryStore(() => new Date(now));
      const t1 = memoryRecord("t1-mem", "API authentication uses session cookies.", {
        tenantId: "tenant-1",
        namespace: { scope: "project", id: "p1" },
      });
      const t2 = memoryRecord("t2-mem", "API authentication uses bearer tokens.", {
        tenantId: "tenant-2",
        namespace: { scope: "project", id: "p1" },
      });
      await store.insert(t1);
      await store.insert(t2);

      const retriever = new HybridMemoryRetriever(store, { now: () => now });
      const t1Access: MemoryAccessContext = {
        principalId: "user-1",
        tenantId: "tenant-1",
        readableNamespaces: [{ scope: "project", id: "p1" }],
        writableNamespaces: [{ scope: "project", id: "p1" }],
      };

      const res = await retriever.retrieve({ text: "API authentication", namespaces: [{ scope: "project", id: "p1" }] }, t1Access);
      expect(res.results.map(r => r.memory.id)).toEqual(["t1-mem"]);
      expect(res.diagnostics.conflict?.suppressed).toBe(0);
    });

    test("conflict detection never groups memories across different namespaces", async () => {
      const memNs1 = memoryRecord("ns1-mem", "Production runs on virtual machines.", {
        namespace,
        metadata: { __reliability_verification_status: "stale" },
      });
      const memNs2 = memoryRecord("ns2-mem", "Production runs on Kubernetes.", {
        namespace: otherNamespace,
        metadata: { __reliability_verification_status: "verified" },
      });

      const store = new InMemoryMemoryStore(() => new Date(now));
      await store.insert(memNs1);
      await store.insert(memNs2);

      const retriever = new HybridMemoryRetriever(store, { now: () => now });
      const res = await retriever.retrieve({ text: "Production platform", namespaces: [namespace] }, access);
      expect(res.results.map(r => r.memory.id)).toEqual(["ns1-mem"]);
    });
  });
});
