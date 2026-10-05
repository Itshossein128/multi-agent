import { createAgentRecord } from "@multi-agent/types";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { InMemoryOrganizationStore } from "../apps/server/src/organization/organizationStore";
import { OrganizationService } from "../apps/server/src/organization/organizationService";

const alice = { userId: "alice", tenantId: "tenant-a" };
const bob = { userId: "bob", tenantId: "tenant-b" };

describe("organization goals and delegation", () => {
  it("keeps one CEO, rejects reporting cycles, and links delegated tasks to goals", async () => {
    const studio = new InMemoryStudioStore();
    const service = new OrganizationService(new InMemoryOrganizationStore(), studio);
    const ceo = await studio.saveAgent({ ...createAgentRecord({ name: "CEO" }), id: "ceo" }, alice);
    const manager = await studio.saveAgent({ ...createAgentRecord({ name: "Manager" }), id: "manager" }, alice);
    const worker = await studio.saveAgent({ ...createAgentRecord({ name: "Worker" }), id: "worker" }, alice);
    await service.setReportingLine(ceo.id, { role: "ceo" }, alice);
    await service.setReportingLine(manager.id, { role: "manager", managerAgentId: ceo.id }, alice);
    await service.setReportingLine(worker.id, { role: "member", managerAgentId: manager.id }, alice);
    await expect(service.setReportingLine(worker.id, { role: "ceo" }, alice)).rejects.toThrow("already has a CEO");
    await expect(service.setReportingLine(manager.id, { role: "manager", managerAgentId: worker.id }, alice)).rejects.toThrow("cycle");
    const goal = await service.createGoal({ title: "Build onboarding", ownerAgentId: ceo.id, proposedByAgentId: ceo.id }, alice);
    expect(goal.status).toBe("proposed");
    await expect(service.delegate(goal.id, { agentId: worker.id }, alice)).rejects.toThrow("Only active goals");
    await service.updateGoal(goal.id, { status: "active" }, alice);
    const task = await service.delegate(goal.id, { agentId: worker.id }, alice);
    expect(task.metadata?.organizationGoalId).toBe(goal.id);
    expect(task.assignedAgent).toBe(worker.id);
    expect(task.projectIds).toHaveLength(1);
    const proposal = await service.requestStrategyProposal({ title: "Grow reliability", brief: "Reduce failed runs" }, alice);
    expect(proposal.goal.status).toBe("proposed");
    expect(proposal.task.assignedAgent).toBe(ceo.id);
    expect(proposal.task.metadata?.strategyProposal).toBe(true);
    await expect(service.updateGoal(proposal.goal.id, { status: "active" }, alice)).rejects.toThrow("strategy task must finish");
    await studio.saveTask({ ...proposal.task, status: "done", output: "Prioritize retries and monitor failures." }, alice);
    expect((await service.updateGoal(proposal.goal.id, { status: "active" }, alice)).status).toBe("active");
    expect((await service.overview(bob)).goals).toHaveLength(0);
  });

  it("keeps the in-memory reporting graph acyclic when updates race", async () => {
    const studio = new InMemoryStudioStore();
    const service = new OrganizationService(new InMemoryOrganizationStore(), studio);
    for (const id of ["ceo", "a", "b"]) await studio.saveAgent({ ...createAgentRecord({ name: id }), id }, alice);
    await service.setReportingLine("ceo", { role: "ceo" }, alice);
    await service.setReportingLine("a", { role: "manager", managerAgentId: "ceo" }, alice);
    await service.setReportingLine("b", { role: "manager", managerAgentId: "ceo" }, alice);
    const updates = await Promise.allSettled([
      service.setReportingLine("a", { role: "manager", managerAgentId: "b" }, alice),
      service.setReportingLine("b", { role: "manager", managerAgentId: "a" }, alice),
    ]);
    expect(updates.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter(result => result.status === "rejected")).toHaveLength(1);
  });
});
