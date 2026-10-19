import crypto from "node:crypto";
import { createEdge, createEmptyDefinition, createNode, nowIso } from "@multi-agent/types";
import { createInboundWebhookRouter } from "../apps/server/src/api/studio/webhookTriggerRoutes";
import { encryptWebhookSecret } from "../apps/server/src/triggers/webhookAuth";
import { TriggerOutboxProcessor } from "../apps/server/src/triggers/triggerOutboxProcessor";
import { RunOrganizationAccess } from "../apps/server/src/runtime/runOrganizationAccess";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { seedUs2 } from "./organizationUs2Fixtures";

describe("webhook security regressions", () => {
  const owner = { tenantId: "org-a", userId: "admin" };
  const secret = "webhook-test-secret";
  let store: InMemoryStudioStore;

  beforeEach(async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = "webhook-test-encryption-key-at-least-32-characters";
    store = new InMemoryStudioStore();
    await seedUs2(store);
    await store.saveWorkflow({ ...createEmptyDefinition(), id: "private-workflow", name: "private", updatedAt: nowIso() }, owner);
    await store.saveWebhookTrigger({ id: "trigger", tenantId: "org-a", ownerId: "admin", name: "trigger", description: "", secretHash: encryptWebhookSecret(secret), targetType: "workflow", targetId: "private-workflow", enabled: true, rateLimitPerMinute: 100, createdAt: nowIso(), updatedAt: nowIso() }, owner);
  });

  it("rejects concurrent replays with different unsigned keys and signature representations", async () => {
    const router = createInboundWebhookRouter(store);
    const body = JSON.stringify({ message: "execute" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const mac = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const requests = Array.from({ length: 8 }, (_, i) => router.request("/triggers/trigger", {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-signature": i % 2 ? `sha256=${mac.toUpperCase()}` : mac, "x-webhook-timestamp": timestamp, "idempotency-key": `changed-${i}` }, body,
    }));
    const responses = await Promise.all(requests);
    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await store.listTriggerEvents({ tenantId: "org-a" })).toHaveLength(1);
  });

  it("refuses an already accepted delivery after its creator loses membership", async () => {
    await store.acceptWebhookDelivery({ triggerId: "trigger", payload: {} });
    const membership = await store.getMembership("org-a", "admin");
    await store.saveMembership({ ...membership!, status: "removed", version: membership!.version + 1, removedAt: nowIso() });
    const start = jest.fn().mockReturnValue("run");
    const processor = new TriggerOutboxProcessor(store, { start } as never, undefined, {}, new RunOrganizationAccess(store));
    await processor.tick();
    expect(start).not.toHaveBeenCalled();
    expect((await store.listTriggerEvents({ tenantId: "org-a" }))[0].status).toBe("dead_letter");
  });

  it("does not dispatch a webhook whose target is no longer accessible to its creator", async () => {
    await store.saveWorkflow({ ...createEmptyDefinition(), id: "other-private", name: "other", updatedAt: nowIso() }, { tenantId: "org-a", userId: "owner" });
    await store.enqueueTriggerEvent({ tenantId: "org-a", eventType: "webhook_inbound", targetType: "workflow", targetId: "other-private", idempotencyKey: "forged", payload: { triggerId: "trigger" } });
    const start = jest.fn();
    await new TriggerOutboxProcessor(store, { start } as never).tick();
    expect(start).not.toHaveBeenCalled();
    expect((await store.listTriggerEvents({ tenantId: "org-a" }))[0].status).toBe("dead_letter");
  });

  it("stops a delivery when the creator is demoted below credential-management access", async () => {
    await store.acceptWebhookDelivery({ triggerId: "trigger", payload: {} });
    const membership = await store.getMembership("org-a", "admin");
    await store.saveMembership({ ...membership!, role: "member", version: membership!.version + 1 });
    const start = jest.fn();
    await new TriggerOutboxProcessor(store, { start } as never).tick();
    expect(start).not.toHaveBeenCalled();
    expect((await store.listTriggerEvents({ tenantId: "org-a" }))[0].status).toBe("dead_letter");
  });

  it("keeps the creator's membership boundary on a dispatched run", async () => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 1, y: 0 });
    await store.saveWorkflow({ ...createEmptyDefinition(), id: "private-workflow", name: "private", nodes: [input, output], edges: [createEdge({ source: input.id, target: output.id })], updatedAt: nowIso() }, owner);
    await store.acceptWebhookDelivery({ triggerId: "trigger", payload: {} });
    const runs = new InMemoryRunStore();
    const access = new RunOrganizationAccess(store);
    await new TriggerOutboxProcessor(store, new RunExecutor(runs), undefined, {}, access).tick();
    const run = runs.list()[0];
    expect(run).toMatchObject({ ownerId: "admin", initiatorKind: "user", serverInitiated: false });
    const membership = await store.getMembership("org-a", "admin");
    await store.saveMembership({ ...membership!, status: "removed", version: membership!.version + 1, removedAt: nowIso() });
    await expect(access.assertRunActive(run)).rejects.toMatchObject({ code: "ORGANIZATION_ACCESS_REVOKED" });
  });
});
