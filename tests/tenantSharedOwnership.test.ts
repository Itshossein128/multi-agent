import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import { nowIso } from "@multi-agent/types";

describe("Tenant-shared entity ownership (ownerId: null)", () => {
  const org = "org-test-ownership";
  const ownerPrincipal = { userId: "user-owner", tenantId: org };
  const adminPrincipal = { userId: "user-admin", tenantId: org };

  it("preserves tenant-shared agent (ownerId: null) when created by owner and accessible by admin", async () => {
    const store = new InMemoryStudioStore();
    const stamp = nowIso();

    const sharedAgent: AgentRecord = {
      id: "agent-shared-1",
      name: "Tenant Shared Agent",
      record: { id: "agent-shared-1", name: "Tenant Shared Agent", backend: { type: "built-in" } },
      backend: { type: "built-in" },
      ownerId: null,
      tenantId: org,
      isSystem: false,
      createdAt: stamp,
      updatedAt: stamp,
    } as any;

    const saved = await store.saveAgent(sharedAgent, ownerPrincipal);
    expect(saved.ownerId).toBeUndefined();

    const fetchedByAdmin = await store.getAgent("agent-shared-1", adminPrincipal);
    expect(fetchedByAdmin).not.toBeNull();
    expect(fetchedByAdmin?.id).toBe("agent-shared-1");
  });

  it("preserves tenant-shared tool (ownerId: null) when created by owner and accessible by admin", async () => {
    const store = new InMemoryStudioStore();
    const stamp = nowIso();

    const sharedTool: ToolRecord = {
      id: "tool-shared-1",
      name: "Tenant Shared Tool",
      description: "",
      configuration: {},
      ownerId: null,
      tenantId: org,
      isSystem: false,
      createdAt: stamp,
      updatedAt: stamp,
    } as any;

    const saved = await store.saveTool(sharedTool, ownerPrincipal);
    expect(saved.ownerId).toBeUndefined();

    const fetchedByAdmin = await store.getTool("tool-shared-1", adminPrincipal);
    expect(fetchedByAdmin).not.toBeNull();
    expect(fetchedByAdmin?.id).toBe("tool-shared-1");
  });

  it("preserves tenant-shared workflow (ownerId: null) when created by owner and accessible by admin", async () => {
    const store = new InMemoryStudioStore();
    const stamp = nowIso();

    const sharedWf: WorkflowDefinition = {
      id: "wf-shared-1",
      name: "Tenant Shared Workflow",
      nodes: [],
      edges: [],
      ownerId: null as any,
      tenantId: org,
      updatedAt: stamp,
    };

    const saved = await store.saveWorkflow(sharedWf, ownerPrincipal);
    expect(saved.ownerId).toBeUndefined();

    const fetchedByAdmin = await store.getWorkflow("wf-shared-1", adminPrincipal);
    expect(fetchedByAdmin).not.toBeNull();
    expect(fetchedByAdmin?.id).toBe("wf-shared-1");
  });
});
