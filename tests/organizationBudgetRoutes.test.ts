import { createAgentRecord } from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { InMemoryOrganizationStore } from "../apps/server/src/organization/organizationStore";
import { InMemoryBudgetStore } from "../apps/server/src/budgets/budgetStore";

const principal = { userId: "alice", tenantId: "company-a" };

it("serves organization and budget controls through the authenticated studio router", async () => {
  const studio = new InMemoryStudioStore();
  const stamp = new Date().toISOString();
  await studio.saveProject({ id: "project-org", tenantId: principal.tenantId, ownerId: principal.userId,
    name: "Org project", nameSource: "manual", description: "", status: "active", settings: {}, createdAt: stamp, updatedAt: stamp }, principal);
  const agent = await studio.saveAgent({ ...createAgentRecord({ name: "CEO" }), id: "ceo-agent" }, principal);
  const app = createStudioRouter(studio, () => principal, undefined, new InMemoryOrganizationStore(), new InMemoryBudgetStore());
  const putLine = await app.request(`/organization/agents/${agent.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "ceo" }) });
  expect(putLine.status).toBe(200);
  const goalResponse = await app.request("/organization/strategy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Improve reliability", brief: "Reduce failed runs", projectId: "project-org" }) });
  expect(goalResponse.status).toBe(201);
  const budgetResponse = await app.request("/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "company", limitUsd: 10, thresholdPercent: 80 }) });
  expect(budgetResponse.status).toBe(200);
  expect((await app.request("/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "null" })).status).toBe(400);
  expect((await app.request("/organization/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" })).status).toBe(400);
  const [organization, budgets] = await Promise.all([app.request("/organization"), app.request("/budgets")]);
  expect((await organization.json()).goals).toHaveLength(1);
  expect((await budgets.json()).budgets).toMatchObject([{ limitUsd: 10 }]);
});
