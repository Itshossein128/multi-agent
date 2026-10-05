import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { createTestStudioService, memoryStorage } from "./fixtures/studioService";
import { deleteWorkflowConfirmMessage } from "../apps/web/src/lib/workflow/deleteConfirmMessage";

describe("workflow delete", () => {
  test("owner DELETE removes workflow from list and get", async () => {
    const { service, storage } = createTestStudioService();
    const created = await service.createWorkflow("Delete Me");
    storage.setItem("agent-studio.active-workflow.v1", created.id);

    await service.deleteWorkflow(created.id);

    const listed = await service.listWorkflows();
    expect(listed.some((workflow) => workflow.id === created.id)).toBe(false);
    expect(await service.getWorkflow(created.id)).toBeNull();
    expect(storage.getItem("agent-studio.active-workflow.v1")).toBeNull();
  });

  test("after deleting workflow A while B exists, list keeps B only", async () => {
    const { service } = createTestStudioService();
    const a = await service.createWorkflow("Workflow A");
    const b = await service.createWorkflow("Workflow B");

    await service.deleteWorkflow(a.id);

    const listed = await service.listWorkflows();
    expect(listed.map((workflow) => workflow.id).sort()).toEqual([b.id].sort());
    expect(await service.getWorkflow(a.id)).toBeNull();
    expect((await service.getWorkflow(b.id))?.name).toBe("Workflow B");
  });

  test("rejected DELETE leaves workflow listed for the owner", async () => {
    class FailingDeleteStore extends InMemoryStudioStore {
      override async deleteWorkflow(id: string, principal?: { userId: string; tenantId: string }): Promise<void> {
        void id;
        void principal;
        throw new Error("simulated delete failure");
      }
    }
    const { service } = createTestStudioService(memoryStorage(), new FailingDeleteStore());
    const created = await service.createWorkflow("Keep Me");

    await expect(service.deleteWorkflow(created.id)).rejects.toThrow();

    const listed = await service.listWorkflows();
    expect(listed.some((workflow) => workflow.id === created.id)).toBe(true);
    expect((await service.getWorkflow(created.id))?.name).toBe("Keep Me");
  });

  test("delete confirm message names the workflow and states permanence", () => {
    expect(deleteWorkflowConfirmMessage("Onboarding Intake")).toContain("Onboarding Intake");
    expect(deleteWorkflowConfirmMessage("Onboarding Intake")).toMatch(/cannot be undone/i);
    expect(deleteWorkflowConfirmMessage("Draft", true)).toMatch(/unsaved edits/i);
    expect(deleteWorkflowConfirmMessage("   ")).toContain("Untitled Workflow");
  });
});
