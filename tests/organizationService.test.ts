import { createAgentRecord } from "@multi-agent/types";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { InMemoryOrganizationStore, type OrganizationStore } from "../apps/server/src/organization/organizationStore";
import { OrganizationService } from "../apps/server/src/organization/organizationService";

const alice = { userId: "alice", tenantId: "tenant-a" };
const bob = { userId: "bob", tenantId: "tenant-b" };

async function setupOrganization() {
  const studio = new InMemoryStudioStore();
  const organization = new InMemoryOrganizationStore();
  const service = new OrganizationService(organization, studio);
  const stamp = new Date().toISOString();
  for (const [id, principal, status] of [
    ["project-org", alice, "active"], ["retired", alice, "retired"], ["foreign", bob, "active"],
  ] as const) {
    await studio.saveProject({ id, tenantId: principal.tenantId, ownerId: principal.userId, name: id,
      nameSource: "manual", description: "", status, settings: {}, createdAt: stamp, updatedAt: stamp }, principal);
  }
  await studio.saveAgent({ ...createAgentRecord({ name: "CEO" }), id: "ceo" }, alice);
  await service.setReportingLine("ceo", { role: "ceo" }, alice);
  return { studio, organization, service };
}

describe("goal project validation", () => {
  it.each([
    ["unknown", 404, "Project not found"], ["foreign", 404, "Project not found"], ["retired", 409, "Project is retired"],
  ])("rejects %s before saving a goal", async (projectId, status, message) => {
    const { service, organization } = await setupOrganization();
    await expect(service.createGoal({ title: "Goal", projectId: projectId as string }, alice)).rejects.toMatchObject({ status, message });
    expect(await organization.goals(alice.tenantId)).toHaveLength(0);
  });
  it("still allows a goal without a project", async () => {
    const { service } = await setupOrganization();
    expect(await service.createGoal({ title: "Company goal" }, alice)).toMatchObject({ projectId: null });
  });
});

describe("strategy project validation and atomicity", () => {
  const proposal = { title: "Reliability", brief: "Reduce failed runs", projectId: "project-org" };
  it.each([
    [undefined, 400, "projectId is required"], ["foreign", 404, "Project not found"], ["retired", 409, "Project is retired"],
  ])("rejects project %s without any writes", async (projectId, status, message) => {
    const { studio, organization, service } = await setupOrganization();
    await expect(service.requestStrategyProposal({ ...proposal, projectId: projectId as string | undefined }, alice)).rejects.toMatchObject({ status, message });
    expect(await organization.goals(alice.tenantId)).toHaveLength(0);
    expect(await studio.listTasks(alice)).toHaveLength(0);
    expect(await studio.listTriggerEvents({ tenantId: alice.tenantId })).toHaveLength(0);
  });
  it.each(["saveTask", "enqueueTriggerEvent"] as const)("rolls back when %s fails", async method => {
    const { studio, organization, service } = await setupOrganization();
    jest.spyOn(studio, method).mockRejectedValueOnce(new Error("injected"));
    await expect(service.requestStrategyProposal(proposal, alice)).rejects.toThrow("injected");
    expect(await organization.goals(alice.tenantId)).toHaveLength(0);
    expect(await studio.listTasks(alice)).toHaveLength(0);
    expect(await studio.listTriggerEvents({ tenantId: alice.tenantId })).toHaveLength(0);
  });
  it("fails closed on mixed stores before saving a goal", async () => {
    const { studio, organization } = await setupOrganization();
    const custom: OrganizationStore = {
      goals: organization.goals.bind(organization), saveGoal: jest.fn(organization.saveGoal.bind(organization)),
      reportingLines: organization.reportingLines.bind(organization), saveReportingLine: organization.saveReportingLine.bind(organization),
    };
    await expect(new OrganizationService(custom, studio).requestStrategyProposal(proposal, alice)).rejects.toMatchObject({ status: 503, message: "Atomic organization operations are not configured" });
    expect(custom.saveGoal).not.toHaveBeenCalled();
    expect(await studio.listTasks(alice)).toHaveLength(0);
  });
});

describe("organization goals and delegation", () => {
  it("keeps one CEO, rejects reporting cycles, and links delegated tasks to goals", async () => {
    const studio = new InMemoryStudioStore();
    const service = new OrganizationService(new InMemoryOrganizationStore(), studio);
    const stamp = new Date().toISOString();
    await studio.saveProject({
      id: "project-org",
      tenantId: alice.tenantId,
      name: "Org Project",
      nameSource: "manual",
      description: "",
      status: "active",
      settings: {},
      createdAt: stamp,
      updatedAt: stamp,
      ownerId: alice.userId,
    }, alice);
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
    const delegation = { agentId: worker.id, projectId: "project-org" };
    const task = await service.delegate(goal.id, delegation, alice);
    expect(task.metadata?.organizationGoalId).toBe(goal.id);
    expect(task.assignedAgent).toBe(worker.id);
    expect(task.projectId).toBe("project-org");
    expect(task.workspaceId).toBeNull();
    const proposal = await service.requestStrategyProposal({ title: "Grow reliability", brief: "Reduce failed runs", projectId: "project-org" }, alice);
    expect(proposal.goal.status).toBe("proposed");
    expect(proposal.goal.projectId).toBe("project-org");
    expect(proposal.task.projectId).toBe("project-org");
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

describe("explicit project for delegation", () => {
  it.each([
    { goalProject: null, bodyProject: undefined, status: 400, message: "projectId is required" },
    { goalProject: "project-org", bodyProject: "other", status: 400, message: "projectId must match the goal's project" },
    { goalProject: null, bodyProject: "foreign", status: 404, message: "Project not found" },
    { goalProject: null, bodyProject: "retired", status: 409, message: "Project is retired" },
  ])("rejects invalid delegation project ($bodyProject)", async ({ goalProject, bodyProject, status, message }) => {
    const { studio, service } = await setupOrganization();
    const goal = await service.createGoal({ title: "Goal", projectId: goalProject }, alice);
    const input = { agentId: "ceo", projectId: bodyProject };
    await expect(service.delegate(goal.id, input, alice)).rejects.toMatchObject({ status, message });
    expect(await studio.listTasks(alice)).toHaveLength(0);
    expect(await studio.listTriggerEvents({ tenantId: alice.tenantId })).toHaveLength(0);
  });
  it.each([null, "project-org"])("uses the explicit project with goal project %s", async goalProject => {
    const { service } = await setupOrganization();
    const goal = await service.createGoal({ title: "Goal", projectId: goalProject }, alice);
    const input = { agentId: "ceo", ...(goalProject ? {} : { projectId: "project-org" }) };
    expect(await service.delegate(goal.id, input, alice)).toMatchObject({ projectId: "project-org" });
  });
});
