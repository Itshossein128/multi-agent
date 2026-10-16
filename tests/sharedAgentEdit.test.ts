import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Hono } from "hono";
import { nowIso, type AgentRecord, type ToolRecord } from "@multi-agent/types";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { AgentService } from "../apps/server/src/api/studio/agentService";
import { StudioToolService } from "../apps/server/src/api/studio/toolService";
import { registerAgentRoutes } from "../apps/server/src/api/studio/agentRoutes";
import { registerToolRoutes } from "../apps/server/src/api/studio/toolRoutes";
import type { RequestPrincipal } from "../apps/server/src/auth/principal";
import type { PrincipalVariables } from "../apps/server/src/api/shared/http";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

function sampleAgent(id: string, tenantId: string, ownerId?: string): AgentRecord {
  const stamp = nowIso();
  return {
    id,
    name: "Sample Agent",
    description: "Initial description",
    backend: { type: "local", provider: "ollama", model: "llama3" },
    systemPrompt: "You are an agent",
    tools: [],
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
    tenantId,
    ownerId,
    isSystem: false,
  };
}

function sampleTool(id: string, tenantId: string, ownerId?: string): ToolRecord {
  const stamp = nowIso();
  return {
    id,
    name: "Sample Tool",
    description: "Initial tool description",
    category: "custom",
    inputSchema: {},
    outputSchema: {},
    configuration: {},
    enabled: true,
    impact: "read-only",
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
    tenantId,
    ownerId,
    isSystem: false,
  };
}

describe("shared agent and tool edit ownership (T084 / F4)", () => {
  describe("in-memory studio store", () => {
    it("preserves null/undefined ownerId when member edits shared agent, and allows other member to edit", async () => {
      const store = new InMemoryStudioStore();
      const orgId = "org-1";
      const agentId = "agent-shared-1";
      const userA: RequestPrincipal = { userId: "user-a", tenantId: orgId, organizationId: orgId };
      const userB: RequestPrincipal = { userId: "user-b", tenantId: orgId, organizationId: orgId };

      // Shared agent created with no ownerId (organization-owned)
      await store.saveAgent(sampleAgent(agentId, orgId));

      const shared = await store.getAgent(agentId, userA);
      expect(shared).not.toBeNull();
      expect(shared?.ownerId).toBeFalsy();

      // User A creates an unowned (organization-shared) agent explicitly passing ownerId: null with userA principal context
      const newShared = await store.saveAgent({ ...sampleAgent("agent-shared-new", orgId), ownerId: null as any }, userA);
      expect(newShared.ownerId).toBeFalsy();

      // User A edits the shared agent
      const updatedByA = await store.saveAgent(
        { ...shared!, description: "Updated by User A", updatedAt: nowIso() },
        userA,
      );

      // Must NOT stamp user A as owner
      expect(updatedByA.ownerId).toBeFalsy();

      // User B must still be able to read and edit the shared agent
      const readByB = await store.getAgent(agentId, userB);
      expect(readByB).not.toBeNull();
      expect(readByB?.description).toBe("Updated by User A");
      expect(readByB?.ownerId).toBeFalsy();

      const updatedByB = await store.saveAgent(
        { ...readByB!, description: "Updated by User B", updatedAt: nowIso() },
        userB,
      );
      expect(updatedByB.ownerId).toBeFalsy();
      expect(updatedByB.description).toBe("Updated by User B");
    });

    it("preserves null/undefined ownerId when member edits shared tool, and allows other member to edit", async () => {
      const store = new InMemoryStudioStore();
      const orgId = "org-1";
      const toolId = "tool-shared-1";
      const userA: RequestPrincipal = { userId: "user-a", tenantId: orgId, organizationId: orgId };
      const userB: RequestPrincipal = { userId: "user-b", tenantId: orgId, organizationId: orgId };

      // Shared tool created with no ownerId
      await store.saveTool(sampleTool(toolId, orgId));

      const shared = await store.getTool(toolId, userA);
      expect(shared).not.toBeNull();
      expect(shared?.ownerId).toBeFalsy();

      // User A edits shared tool
      const updatedByA = await store.saveTool(
        { ...shared!, description: "Updated tool by User A", updatedAt: nowIso() },
        userA,
      );
      expect(updatedByA.ownerId).toBeFalsy();

      // User B must still be able to read and edit
      const readByB = await store.getTool(toolId, userB);
      expect(readByB).not.toBeNull();
      expect(readByB?.ownerId).toBeFalsy();

      const updatedByB = await store.saveTool(
        { ...readByB!, description: "Updated tool by User B", updatedAt: nowIso() },
        userB,
      );
      expect(updatedByB.ownerId).toBeFalsy();
      expect(updatedByB.description).toBe("Updated tool by User B");
    });

    it("prevents changing personal agent ownership or stealing personal records", async () => {
      const store = new InMemoryStudioStore();
      const orgId = "org-1";
      const agentId = "agent-personal-1";
      const userA: RequestPrincipal = { userId: "user-a", tenantId: orgId, organizationId: orgId };
      const userB: RequestPrincipal = { userId: "user-b", tenantId: orgId, organizationId: orgId };

      // User A creates personal agent
      await store.saveAgent(sampleAgent(agentId, orgId, "user-a"), userA);

      const personal = await store.getAgent(agentId, userA);
      expect(personal?.ownerId).toBe("user-a");

      // User A edits personal agent: ownerId remains user-a
      const updated = await store.saveAgent(
        { ...personal!, description: "Personal updated" },
        userA,
      );
      expect(updated.ownerId).toBe("user-a");

      // User B cannot edit User A's personal agent
      await expect(
        store.saveAgent({ ...personal!, description: "Stolen by B" }, userB),
      ).rejects.toThrow(/access denied/i);
    });
  });

  (databaseUrl ? describe : describe.skip)("postgres studio store", () => {
    let admin: Pool;
    let pool: Pool;
    let schema: string;
    let store: PostgresStudioStore;

    beforeEach(async () => {
      schema = `shared_edit_${randomUUID().replace(/-/g, "")}`;
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema},public`,
      });
      await runStudioMigrations(pool);
      store = new PostgresStudioStore(pool);
    }, 60_000);

    afterEach(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });

    it("preserves NULL owner_id in database columns and JSON record when member edits shared agent/tool", async () => {
      const orgId = randomUUID();
      const agentId = `agent-${randomUUID()}`;
      const toolId = `tool-${randomUUID()}`;
      const userA: RequestPrincipal = { userId: randomUUID(), tenantId: orgId, organizationId: orgId };
      const userB: RequestPrincipal = { userId: randomUUID(), tenantId: orgId, organizationId: orgId };

      // Insert shared agent and tool without principal (or as shared)
      await store.saveAgent(sampleAgent(agentId, orgId));
      await store.saveTool(sampleTool(toolId, orgId));

      // User A updates the shared agent
      const agentA = await store.getAgent(agentId, userA);
      expect(agentA).not.toBeNull();
      expect(agentA?.ownerId).toBeFalsy();

      const savedAgent = await store.saveAgent(
        { ...agentA!, description: "PG updated by User A", updatedAt: nowIso() },
        userA,
      );
      expect(savedAgent.ownerId).toBeFalsy();

      // Check PostgreSQL table directly: owner_id column and JSON record must be NULL
      const agentRow = await pool.query("SELECT owner_id, record FROM studio_agents WHERE id = $1", [agentId]);
      expect(agentRow.rows[0].owner_id).toBeNull();
      const agentRecord = typeof agentRow.rows[0].record === "string"
        ? JSON.parse(agentRow.rows[0].record)
        : agentRow.rows[0].record;
      expect(agentRecord.ownerId).toBeFalsy();

      // User B can read and edit the shared agent
      const readByB = await store.getAgent(agentId, userB);
      expect(readByB).not.toBeNull();
      expect(readByB?.description).toBe("PG updated by User A");

      const savedByB = await store.saveAgent(
        { ...readByB!, description: "PG updated by User B", updatedAt: nowIso() },
        userB,
      );
      expect(savedByB.ownerId).toBeFalsy();
      expect(savedByB.description).toBe("PG updated by User B");

      // Same check for shared tool
      const toolA = await store.getTool(toolId, userA);
      expect(toolA).not.toBeNull();
      expect(toolA?.ownerId).toBeFalsy();

      const savedTool = await store.saveTool(
        { ...toolA!, description: "PG tool updated by User A", updatedAt: nowIso() },
        userA,
      );
      expect(savedTool.ownerId).toBeFalsy();

      const toolRow = await pool.query("SELECT owner_id, record FROM studio_tools WHERE id = $1", [toolId]);
      expect(toolRow.rows[0].owner_id).toBeNull();
      const toolRecord = typeof toolRow.rows[0].record === "string"
        ? JSON.parse(toolRow.rows[0].record)
        : toolRow.rows[0].record;
      expect(toolRecord.ownerId).toBeFalsy();

      // User B can read and edit the shared tool
      const toolReadByB = await store.getTool(toolId, userB);
      expect(toolReadByB).not.toBeNull();
      const toolSavedByB = await store.saveTool(
        { ...toolReadByB!, description: "PG tool updated by User B", updatedAt: nowIso() },
        userB,
      );
      expect(toolSavedByB.ownerId).toBeFalsy();
    });
  });

  describe("HTTP PATCH routes", () => {
    it("returns null/undefined ownerId when updating a shared agent/tool via HTTP PATCH", async () => {
      const store = new InMemoryStudioStore();
      const orgId = "org-1";
      const agentId = "agent-http-1";
      const toolId = "tool-http-1";
      const userA: RequestPrincipal = { userId: "user-a", tenantId: orgId, organizationId: orgId };
      const userB: RequestPrincipal = { userId: "user-b", tenantId: orgId, organizationId: orgId };

      await store.saveAgent(sampleAgent(agentId, orgId));
      await store.saveTool(sampleTool(toolId, orgId));

      let currentPrincipal: RequestPrincipal = userA;
      const app = new Hono<{ Variables: PrincipalVariables }>();
      app.use("*", async (c, next) => {
        c.set("principal", currentPrincipal);
        await next();
      });
      registerAgentRoutes(app, new AgentService(store));
      registerToolRoutes(app, new StudioToolService(store));

      // User A patches shared agent
      const patchAgentRes = await app.request(`/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Patched by User A" }),
      });
      expect(patchAgentRes.status).toBe(200);
      const patchedAgent = await patchAgentRes.json();
      expect(patchedAgent.ownerId).toBeFalsy();
      expect(patchedAgent.description).toBe("Patched by User A");

      // User B reads agent
      currentPrincipal = userB;
      const getAgentRes = await app.request(`/agents/${agentId}`);
      expect(getAgentRes.status).toBe(200);
      const readAgent = await getAgentRes.json();
      expect(readAgent.ownerId).toBeFalsy();

      // User B patches shared agent
      const patchAgentBRes = await app.request(`/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Patched by User B" }),
      });
      expect(patchAgentBRes.status).toBe(200);
      const patchedAgentB = await patchAgentBRes.json();
      expect(patchedAgentB.ownerId).toBeFalsy();

      // User A patches shared tool
      currentPrincipal = userA;
      const patchToolRes = await app.request(`/tools/${toolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Tool patched by User A" }),
      });
      expect(patchToolRes.status).toBe(200);
      const patchedTool = await patchToolRes.json();
      expect(patchedTool.ownerId).toBeFalsy();

      // User B patches shared tool
      currentPrincipal = userB;
      const patchToolBRes = await app.request(`/tools/${toolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Tool patched by User B" }),
      });
      expect(patchToolBRes.status).toBe(200);
      const patchedToolB = await patchToolBRes.json();
      expect(patchedToolB.ownerId).toBeFalsy();
    });
  });
});
