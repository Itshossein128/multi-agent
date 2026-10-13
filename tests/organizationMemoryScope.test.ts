import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { EmbeddingProvider, Memory, MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";
import { MemoryAccessDeniedError } from "../src/memory/contracts";
import { PostgresMemoryStore, runMemoryMigrations } from "../src/memory/infrastructure";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { HybridMemoryRetriever } from "../src/memory/application/hybridMemoryRetriever";
import { DefaultMemoryService } from "../src/memory/application/memoryService";
import { deriveMemoryAccessFromPrincipal } from "../apps/server/src/memory/access";
import type { RequestPrincipal } from "../apps/server/src/auth/principal";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

const DIMENSIONS = 4;
function createFakeEmbeddingProvider(): EmbeddingProvider {
  return {
    metadata: { provider: "test", model: "fake", dimensions: DIMENSIONS, version: "1" },
    embed: async () => [1, 0, 0, 0], // identical embedding for all test texts
  };
}

function sampleMemory(
  id: string,
  tenantId: string,
  namespace: MemoryNamespace,
  content: string,
): Memory {
  const stamp = new Date().toISOString();
  return {
    id,
    tenantId,
    namespace,
    kind: "semantic",
    visibility: "private",
    content,
    importance: 0.8,
    source: { type: "user" },
    status: "active",
    createdAt: stamp,
    updatedAt: stamp,
    contentHash: id,
    version: 1,
    embedding: [1, 0, 0, 0],
    embeddingMetadata: { provider: "test", model: "fake", dimensions: DIMENSIONS, version: "1" },
  };
}

describe("organization memory scope (T059 / US4)", () => {
  describe("deriving memory access from organization principal (T061 / T093)", () => {
    it("grants read-only organization namespace to viewer and member, read+write to admin and owner", () => {
      const orgId = "org-test-1";
      const viewerPrincipal: RequestPrincipal = {
        userId: "user-viewer",
        tenantId: orgId,
        permissions: ["org.read", "resources.read", "memory.org.read"],
      };

      const viewerAccess = deriveMemoryAccessFromPrincipal(viewerPrincipal);
      expect(viewerAccess.tenantId).toBe(orgId);
      expect(viewerAccess.principalId).toBe("user-viewer");
      expect(viewerAccess.readableNamespaces).toContainEqual({ scope: "organization", id: orgId });
      expect(viewerAccess.writableNamespaces).not.toContainEqual({ scope: "organization", id: orgId });

      const memberPrincipal: RequestPrincipal = {
        userId: "user-member",
        tenantId: orgId,
        permissions: ["org.read", "resources.read", "resources.write", "runs.execute", "memory.org.read"],
      };
      const memberAccess = deriveMemoryAccessFromPrincipal(memberPrincipal);
      expect(memberAccess.readableNamespaces).toContainEqual({ scope: "organization", id: orgId });
      expect(memberAccess.writableNamespaces).not.toContainEqual({ scope: "organization", id: orgId });

      const adminPrincipal: RequestPrincipal = {
        userId: "user-admin",
        tenantId: orgId,
        permissions: ["org.read", "resources.read", "resources.write", "memory.org.read", "memory.org.write", "memory.org.forget"],
      };
      const adminAccess = deriveMemoryAccessFromPrincipal(adminPrincipal);
      expect(adminAccess.readableNamespaces).toContainEqual({ scope: "organization", id: orgId });
      expect(adminAccess.writableNamespaces).toContainEqual({ scope: "organization", id: orgId });
    });

    it("enforces tenant equality and prevents foreign org memory grants", () => {
      const orgId = "org-test-1";
      const principal: RequestPrincipal = {
        userId: "user-1",
        tenantId: orgId,
        permissions: ["org.read", "memory.org.read", "memory.org.write"],
      };
      const access = deriveMemoryAccessFromPrincipal(principal);
      // All derived namespaces must match principal tenantId
      for (const ns of [...access.readableNamespaces, ...access.writableNamespaces]) {
        if (ns.scope === "organization") {
          expect(ns.id).toBe(orgId);
        }
      }
    });
  });

  describe("permission enforcement on organization memory service operations", () => {
    it("viewer and member are denied write and forget for organization memory, but can read", async () => {
      const store = new InMemoryMemoryStore();
      const service = new DefaultMemoryService(store, { embeddingProvider: createFakeEmbeddingProvider() });
      const orgId = "org-test-1";
      const orgNamespace: MemoryNamespace = { scope: "organization", id: orgId };

      const viewerAccess: MemoryAccessContext = {
        principalId: "user-viewer",
        tenantId: orgId,
        readableNamespaces: [orgNamespace],
        writableNamespaces: [], // Viewer has no writable grant on organization scope
      };

      const adminAccess: MemoryAccessContext = {
        principalId: "user-admin",
        tenantId: orgId,
        readableNamespaces: [orgNamespace],
        writableNamespaces: [orgNamespace],
      };

      // Admin writes organization memory
      const writeResult = await service.remember(
        {
          namespace: orgNamespace,
          kind: "semantic",
          content: "Organization policy: All PRs must have tests.",
          source: { type: "user" },
          importance: 0.9,
        },
        adminAccess,
      );
      expect(writeResult.action).toBe("inserted");
      const memoryId = writeResult.memory.id;

      // Viewer can read the memory
      const readMemory = await service.get(memoryId, viewerAccess);
      expect(readMemory).not.toBeNull();
      expect(readMemory?.content).toBe("Organization policy: All PRs must have tests.");

      // Viewer cannot write organization memory
      await expect(
        service.remember(
          {
            namespace: orgNamespace,
            kind: "semantic",
            content: "Viewer trying to write policy",
            source: { type: "user" },
          },
          viewerAccess,
        ),
      ).rejects.toThrow(MemoryAccessDeniedError);

      // Viewer cannot forget organization memory
      await expect(service.forget(memoryId, viewerAccess)).rejects.toThrow(MemoryAccessDeniedError);

      // Admin can forget organization memory
      await service.forget(memoryId, adminAccess);
      expect(await service.get(memoryId, adminAccess)).toBeNull();
    });
  });

  (databaseUrl ? describe : describe.skip)("pgvector retrieval cross-organization isolation", () => {
    let admin: Pool;
    let pool: Pool;
    let schema: string;
    let store: PostgresMemoryStore;
    let retriever: HybridMemoryRetriever;

    beforeEach(async () => {
      schema = `mem_scope_${randomUUID().replace(/-/g, "")}`;
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema},public`,
      });
      await runMemoryMigrations(pool);
      store = new PostgresMemoryStore(pool);
      retriever = new HybridMemoryRetriever(store, {
        embeddingProvider: createFakeEmbeddingProvider(),
      });
    }, 60_000);

    afterEach(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });

    it("filters organization before vector ranking when two organizations have identical embeddings", async () => {
      const orgA = "org-alpha";
      const orgB = "org-beta";
      const nsA: MemoryNamespace = { scope: "organization", id: orgA };
      const nsB: MemoryNamespace = { scope: "organization", id: orgB };

      // Insert memories in Org A and Org B with identical embeddings
      const memA = sampleMemory("mem-alpha-1", orgA, nsA, "Organization coding standard: tabs for indentation");
      const memB = sampleMemory("mem-beta-1", orgB, nsB, "Organization coding standard: spaces for indentation");

      await store.insert(memA);
      await store.insert(memB);

      const accessA: MemoryAccessContext = {
        principalId: "user-a",
        tenantId: orgA,
        readableNamespaces: [nsA],
        writableNamespaces: [nsA],
      };

      const accessB: MemoryAccessContext = {
        principalId: "user-b",
        tenantId: orgB,
        readableNamespaces: [nsB],
        writableNamespaces: [nsB],
      };

      // Query from Org A
      const resultA = await retriever.retrieve(
        { text: "coding standard indentation", namespaces: [nsA], limit: 10 },
        accessA,
      );

      expect(resultA.results.length).toBeGreaterThan(0);
      expect(resultA.results.every((r) => r.memory.tenantId === orgA)).toBe(true);
      expect(resultA.results.some((r) => r.memory.id === memA.id)).toBe(true);
      expect(resultA.results.some((r) => r.memory.id === memB.id)).toBe(false);

      // Query from Org B
      const resultB = await retriever.retrieve(
        { text: "coding standard indentation", namespaces: [nsB], limit: 10 },
        accessB,
      );

      expect(resultB.results.length).toBeGreaterThan(0);
      expect(resultB.results.every((r) => r.memory.tenantId === orgB)).toBe(true);
      expect(resultB.results.some((r) => r.memory.id === memB.id)).toBe(true);
      expect(resultB.results.some((r) => r.memory.id === memA.id)).toBe(false);
    });
  });
});
