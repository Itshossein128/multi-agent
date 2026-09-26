import { InMemoryNotificationOutbox, NotificationDispatcher } from "../src/notifications";

test("notification outbox is idempotent and retries failed delivery", async () => {
  const outbox = new InMemoryNotificationOutbox();
  let attempts = 0;
  const dispatcher = new NotificationDispatcher(outbox, new Map([[
    "webhook", { deliver: async () => { attempts += 1; if (attempts === 1) throw new Error("temporary"); } },
  ]]));
  const message = { id: "n-1", channel: "webhook" as const, recipient: "https://example.test", eventType: "run.completed", payload: { runId: "r-1" }, idempotencyKey: "r-1:completed", createdAt: "2026-09-25T00:00:00.000Z" };
  expect(await dispatcher.publish(message)).toBe(true);
  expect(await dispatcher.publish(message)).toBe(false);
  await dispatcher.drain(new Date("2026-09-25T00:00:00.000Z"));
  await dispatcher.drain(new Date("2026-09-25T00:00:10.000Z"));
  expect(attempts).toBe(2);
});
