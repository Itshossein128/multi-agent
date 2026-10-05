import { nowIso, uid, type WebhookTriggerRecord, type WebhookDeliveryRecord } from "@multi-agent/types";
import { Hono } from "hono";
import type { StudioStore } from "../../../../../src/studio/contracts";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  isTimestampFresh,
  MAX_WEBHOOK_PAYLOAD_BYTES,
  verifyWebhookSignature,
  defaultReplayProtector,
} from "../../triggers/webhookAuth";
import type { PrincipalVariables } from "../shared/http";
import { ApiError } from "../shared/http";

/**
 * Register Studio management routes for webhook triggers.
 * Requires StudioPrincipal (operator authenticated).
 */
export function registerWebhookTriggerRoutes(
  app: Hono<{ Variables: PrincipalVariables }>,
  store: StudioStore,
) {
  // List webhook triggers (secrets redacted)
  app.get("/webhooks/triggers", async (c) => {
    const principal = c.get("principal");
    const triggers = await store.listWebhookTriggers(principal);
    // Redact secretHash
    const safeTriggers = triggers.map(({ secretHash, ...rest }) => ({
      ...rest,
      hasSecret: !!secretHash,
    }));
    return c.json(safeTriggers);
  });

  // Get single webhook trigger
  app.get("/webhooks/triggers/:id", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const trigger = await store.getWebhookTrigger(id, principal);
    if (!trigger) throw new ApiError(404, `Webhook trigger "${id}" not found`);
    const { secretHash, ...rest } = trigger;
    return c.json({ ...rest, hasSecret: !!secretHash });
  });

  // Create webhook trigger
  app.post("/webhooks/triggers", async (c) => {
    const principal = c.get("principal");
    const body = await c.req.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError(400, "Webhook trigger name is required");

    const targetType = body.targetType === "agent" ? "agent" : "workflow";
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) throw new ApiError(400, "Target ID is required");

    // Verify webhook target belongs to tenant and operator may bind to it
    if (targetType === "agent") {
      const agent = await store.getAgent(targetId, principal);
      if (!agent) {
        throw new ApiError(400, `Target agent "${targetId}" not found in current tenant`);
      }
    } else {
      const workflow = await store.getWorkflow(targetId, principal);
      if (!workflow) {
        throw new ApiError(400, `Target workflow "${targetId}" not found in current tenant`);
      }
    }

    const rateLimitPerMinute =
      typeof body.rateLimitPerMinute === "number" && body.rateLimitPerMinute > 0
        ? Math.min(body.rateLimitPerMinute, 1000)
        : 60;

    // Generate secret and encrypt it
    const rawSecret = generateWebhookSecret();
    const encryptedSecret = encryptWebhookSecret(rawSecret);

    const trigger: WebhookTriggerRecord = {
      id: uid("whtrig"),
      tenantId: principal.tenantId,
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      secretHash: encryptedSecret,
      targetType,
      targetId,
      enabled: body.enabled !== false,
      rateLimitPerMinute,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ownerId: principal.userId,
    };

    const saved = await store.saveWebhookTrigger(trigger, principal);
    const { secretHash, ...rest } = saved;

    return c.json(
      {
        trigger: { ...rest, hasSecret: true },
        signingSecret: rawSecret, // Returned once upon creation!
      },
      201,
    );
  });

  // Update webhook trigger
  app.put("/webhooks/triggers/:id", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getWebhookTrigger(id, principal);
    if (!existing) throw new ApiError(404, `Webhook trigger "${id}" not found`);

    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
    const description = typeof body.description === "string" ? body.description.trim() : existing.description;
    const targetType = body.targetType === "agent" || body.targetType === "workflow" ? body.targetType : existing.targetType;
    const targetId = typeof body.targetId === "string" && body.targetId.trim() ? body.targetId.trim() : existing.targetId;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled;
    const rateLimitPerMinute =
      typeof body.rateLimitPerMinute === "number" && body.rateLimitPerMinute > 0
        ? Math.min(body.rateLimitPerMinute, 1000)
        : existing.rateLimitPerMinute;

    // Verify webhook target belongs to tenant if targetId or targetType changed
    if (targetType === "agent") {
      const agent = await store.getAgent(targetId, principal);
      if (!agent) {
        throw new ApiError(400, `Target agent "${targetId}" not found in current tenant`);
      }
    } else {
      const workflow = await store.getWorkflow(targetId, principal);
      if (!workflow) {
        throw new ApiError(400, `Target workflow "${targetId}" not found in current tenant`);
      }
    }

    const updated: WebhookTriggerRecord = {
      ...existing,
      name,
      description,
      targetType,
      targetId,
      enabled,
      rateLimitPerMinute,
      updatedAt: nowIso(),
    };

    const saved = await store.saveWebhookTrigger(updated, principal);
    const { secretHash, ...rest } = saved;
    return c.json({ ...rest, hasSecret: !!secretHash });
  });

  // Rotate signing secret
  app.post("/webhooks/triggers/:id/rotate-secret", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getWebhookTrigger(id, principal);
    if (!existing) throw new ApiError(404, `Webhook trigger "${id}" not found`);

    const newRawSecret = generateWebhookSecret();
    const newEncryptedSecret = encryptWebhookSecret(newRawSecret);

    const updated: WebhookTriggerRecord = {
      ...existing,
      secretHash: newEncryptedSecret,
      updatedAt: nowIso(),
    };

    await store.saveWebhookTrigger(updated, principal);
    return c.json({ signingSecret: newRawSecret });
  });

  // Delete webhook trigger
  app.delete("/webhooks/triggers/:id", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getWebhookTrigger(id, principal);
    if (!existing) throw new ApiError(404, `Webhook trigger "${id}" not found`);
    await store.deleteWebhookTrigger(id, principal);
    return c.json({ ok: true });
  });

  // List deliveries for a trigger
  app.get("/webhooks/triggers/:id/deliveries", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getWebhookTrigger(id, principal);
    if (!existing) throw new ApiError(404, `Webhook trigger "${id}" not found`);
    const deliveries = await store.listWebhookDeliveries(id, principal);
    return c.json(deliveries);
  });
}

/**
 * Stream and bound request body before buffering.
 * Cancels reader immediately if incoming bytes exceed maxBytes without buffering full payload.
 */
async function readBoundedRequestBody(req: Request, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  if (!req.body) {
    return Buffer.alloc(0);
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel("PAYLOAD_TOO_LARGE");
          throw new Error("PAYLOAD_TOO_LARGE");
        }
        chunks.push(value);
      }
    }
  } catch (err: any) {
    if (err?.message === "PAYLOAD_TOO_LARGE") throw err;
    throw new Error(`STREAM_READ_ERROR: ${err?.message}`);
  }

  return Buffer.concat(chunks);
}

/**
 * Create public inbound receiver router for external webhooks.
 * Does NOT require user session / bearer token; authenticates via HMAC signature headers.
 */
export function createInboundWebhookRouter(store: StudioStore): Hono {
  const router = new Hono();

  router.post("/triggers/:id", async (c) => {
    const startTime = Date.now();
    const triggerId = c.req.param("id");
    const deliveryId = uid("deliv");

    // 1. Fetch trigger (cross-tenant lookup by ID)
    const trigger = await store.getWebhookTrigger(triggerId);
    if (!trigger) {
      return c.json({ error: `Webhook trigger "${triggerId}" not found` }, 404);
    }

    if (!trigger.enabled) {
      return c.json({ error: "Webhook trigger is disabled" }, 400);
    }

    // 2. Multi-instance & restart safe rate limiting using durable DB counts
    const recentDeliveriesCount = await store.countRecentWebhookDeliveries(trigger.id, 60);
    if (recentDeliveriesCount >= trigger.rateLimitPerMinute) {
      await store.recordWebhookDelivery({
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "rejected",
        httpStatus: 429,
        errorReason: `Rate limit of ${trigger.rateLimitPerMinute}/min exceeded (${recentDeliveriesCount} deliveries in last 60s)`,
        payloadSummary: {},
        durationMs: Date.now() - startTime,
      });
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    // 3. Stream & bound request body before buffering (1MB limit)
    let rawBuffer: Buffer;
    try {
      rawBuffer = await readBoundedRequestBody(c.req.raw, MAX_WEBHOOK_PAYLOAD_BYTES);
    } catch (err: any) {
      if (err?.message === "PAYLOAD_TOO_LARGE") {
        return c.json({ error: "Payload exceeds 1MB limit" }, 413);
      }
      return c.json({ error: "Failed to read request body" }, 400);
    }
    const rawBody = rawBuffer.toString("utf8");

    // 4. Verify HMAC signature & required timestamp
    const signatureHeader =
      c.req.header("x-webhook-signature") ||
      c.req.header("x-signature-256") ||
      c.req.header("x-hub-signature-256") ||
      "";
    const timestampHeader = c.req.header("x-webhook-timestamp") || c.req.header("x-timestamp");

    let secret = "";
    try {
      secret = decryptWebhookSecret(trigger.secretHash);
    } catch (err: any) {
      await store.recordWebhookDelivery({
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "rejected",
        httpStatus: 500,
        errorReason: `Secret decryption failed: ${err?.message}`,
        payloadSummary: {},
        durationMs: Date.now() - startTime,
      });
      return c.json({ error: "Webhook secret configuration error" }, 500);
    }

    const verification = verifyWebhookSignature(rawBuffer, secret, signatureHeader, timestampHeader);
    if (!verification.valid) {
      await store.recordWebhookDelivery({
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "rejected",
        httpStatus: 401,
        errorReason: verification.reason || "Invalid signature",
        payloadSummary: {},
        durationMs: Date.now() - startTime,
      });
      return c.json({ error: verification.reason || "Unauthorized signature" }, 401);
    }

    // 5. Durable Replay & Idempotency check across restarts & instances
    const clientProvidedIdempotencyKey =
      c.req.header("idempotency-key") ||
      c.req.header("x-idempotency-key");
    const deterministicKey = clientProvidedIdempotencyKey || `${signatureHeader}:${timestampHeader || ""}`;
    const outboxIdempotencyKey = `wh:${trigger.id}:${deterministicKey}`;

    // Fast-path in-memory replay check
    if (!defaultReplayProtector.checkAndRecord(`${trigger.id}:${deterministicKey}`)) {
      await store.recordWebhookDelivery({
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "rejected",
        httpStatus: 409,
        errorReason: "Replay detected (in-memory cache)",
        payloadSummary: {},
        durationMs: Date.now() - startTime,
      });
      return c.json({ error: "Duplicate delivery or replay detected" }, 409);
    }

    // Durable DB check to prevent replays across restarts
    const existingEvents = await store.listTriggerEvents({
      tenantId: trigger.tenantId,
      idempotencyKey: outboxIdempotencyKey,
    });
    if (existingEvents.length > 0) {
      await store.recordWebhookDelivery({
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "rejected",
        httpStatus: 409,
        errorReason: "Replay detected (persisted record)",
        payloadSummary: {},
        durationMs: Date.now() - startTime,
      });
      return c.json({ error: "Duplicate delivery or replay detected" }, 409);
    }

    // 6. Parse JSON body
    let parsedPayload: Record<string, unknown> = {};
    if (rawBody.trim()) {
      try {
        parsedPayload = JSON.parse(rawBody);
      } catch {
        await store.recordWebhookDelivery({
          id: deliveryId,
          tenantId: trigger.tenantId,
          triggerId: trigger.id,
          deliveredAt: nowIso(),
          status: "rejected",
          httpStatus: 400,
          errorReason: "Malformed JSON payload",
          payloadSummary: {},
          durationMs: Date.now() - startTime,
        });
        return c.json({ error: "Malformed JSON payload" }, 400);
      }
    }

    // 7. Coordinate accepted delivery and outbox event atomically
    await store.transaction(async (tx) => {
      await tx.enqueueTriggerEvent({
        tenantId: trigger.tenantId,
        eventType: "webhook_inbound",
        targetType: trigger.targetType,
        targetId: trigger.targetId,
        idempotencyKey: outboxIdempotencyKey,
        payload: {
          triggerId: trigger.id,
          triggerName: trigger.name,
          deliveryId,
          payload: parsedPayload,
        },
      });

      await tx.recordWebhookDelivery({
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "accepted",
        httpStatus: 202,
        payloadSummary: {
          keys: Object.keys(parsedPayload).slice(0, 20),
          sizeBytes: rawBuffer.length,
        },
        durationMs: Date.now() - startTime,
      });
    });

    return c.json({ accepted: true, deliveryId }, 202);
  });

  return router;
}
