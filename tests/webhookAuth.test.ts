import crypto from "node:crypto";
import {
  generateWebhookSecret,
  encryptWebhookSecret,
  decryptWebhookSecret,
  isTimestampFresh,
  verifyWebhookSignature,
  ReplayProtector,
  MAX_WEBHOOK_PAYLOAD_BYTES,
} from "../apps/server/src/triggers/webhookAuth";

describe("Webhook Authentication & Security", () => {
  const originalEnvKey = process.env.WEBHOOK_ENCRYPTION_KEY;
  const testKey = "test-encryption-key-for-webhooks-32-bytes-minimum!!";

  beforeAll(() => {
    process.env.WEBHOOK_ENCRYPTION_KEY = testKey;
  });

  afterAll(() => {
    process.env.WEBHOOK_ENCRYPTION_KEY = originalEnvKey;
  });

  describe("Secret Generation & Encryption", () => {
    it("fails closed when WEBHOOK_ENCRYPTION_KEY is missing or shorter than 32 characters", () => {
      delete process.env.WEBHOOK_ENCRYPTION_KEY;
      expect(() => encryptWebhookSecret("test-secret")).toThrow(/WEBHOOK_ENCRYPTION_KEY must be configured/);

      process.env.WEBHOOK_ENCRYPTION_KEY = "too-short-key";
      expect(() => encryptWebhookSecret("test-secret")).toThrow(/at least 32 characters/);

      // Restore
      process.env.WEBHOOK_ENCRYPTION_KEY = testKey;
    });

    it("generates a secure random secret starting with whsec_", () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();
      expect(secret1).toMatch(/^whsec_[0-9a-f]{48}$/);
      expect(secret2).toMatch(/^whsec_[0-9a-f]{48}$/);
      expect(secret1).not.toBe(secret2);
    });

    it("encrypts and decrypts secret roundtrip with AES-256-GCM", () => {
      const rawSecret = generateWebhookSecret();
      const encrypted = encryptWebhookSecret(rawSecret);
      expect(encrypted).toMatch(/^enc:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(encrypted).not.toBe(rawSecret);

      const decrypted = decryptWebhookSecret(encrypted);
      expect(decrypted).toBe(rawSecret);
    });

    it("rejects plaintext stored secrets (fails closed)", () => {
      const plain = "my-legacy-secret-123";
      expect(() => decryptWebhookSecret(plain)).toThrow(/Plaintext webhook secrets are rejected/);
    });
  });

  describe("Timestamp Freshness", () => {
    it("accepts current timestamp in seconds and milliseconds", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const nowMs = Date.now();
      expect(isTimestampFresh(nowSec).fresh).toBe(true);
      expect(isTimestampFresh(nowMs).fresh).toBe(true);
      expect(isTimestampFresh(new Date().toISOString()).fresh).toBe(true);
    });

    it("accepts timestamp within 300 seconds window", () => {
      const fourMinutesAgo = Date.now() - 240_000;
      expect(isTimestampFresh(fourMinutesAgo, 300).fresh).toBe(true);
    });

    it("rejects timestamp older than 300 seconds (5 minutes)", () => {
      const sixMinutesAgo = Date.now() - 360_000;
      const res = isTimestampFresh(sixMinutesAgo, 300);
      expect(res.fresh).toBe(false);
      expect(res.error).toMatch(/exceeds 300s tolerance/);
    });

    it("rejects future timestamp exceeding tolerance window", () => {
      const tenMinutesFuture = Date.now() + 600_000;
      const res = isTimestampFresh(tenMinutesFuture, 300);
      expect(res.fresh).toBe(false);
    });

    it("rejects invalid timestamp string", () => {
      const res = isTimestampFresh("not-a-date");
      expect(res.fresh).toBe(false);
      expect(res.error).toBe("Invalid timestamp format");
    });
  });

  describe("HMAC Signature Verification", () => {
    const secret = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef";
    const payload = JSON.stringify({ event: "task.created", taskId: "task-123" });

    it("rejects unsigned direct body HMAC (missing timestamp)", () => {
      const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      const res1 = verifyWebhookSignature(payload, secret, `sha256=${hmac}`);
      expect(res1.valid).toBe(false);
      expect(res1.reason).toMatch(/Missing required timestamp/);

      const res2 = verifyWebhookSignature(payload, secret, hmac);
      expect(res2.valid).toBe(false);
      expect(res2.reason).toMatch(/Missing required timestamp/);
    });

    it("verifies Stripe-style combined timestamp signature (t=...,v1=...)", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signedMessage = `${timestamp}.${payload}`;
      const v1 = crypto.createHmac("sha256", secret).update(signedMessage).digest("hex");
      const signatureHeader = `t=${timestamp},v1=${v1}`;

      const res = verifyWebhookSignature(payload, secret, signatureHeader);
      expect(res.valid).toBe(true);
    });

    it("verifies separate timestamp header and sha256 signature", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signedMessage = `${timestamp}.${payload}`;
      const v1 = crypto.createHmac("sha256", secret).update(signedMessage).digest("hex");

      const res = verifyWebhookSignature(payload, secret, `sha256=${v1}`, timestamp);
      expect(res.valid).toBe(true);
    });

    it("rejects forged or modified payload", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signedMessage = `${timestamp}.${payload}`;
      const v1 = crypto.createHmac("sha256", secret).update(signedMessage).digest("hex");
      const tamperedPayload = JSON.stringify({ event: "task.created", taskId: "task-999" });
      const signatureHeader = `t=${timestamp},v1=${v1}`;

      const res = verifyWebhookSignature(tamperedPayload, secret, signatureHeader);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("Signature mismatch");
    });

    it("rejects wrong secret key", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const wrongSecret = "whsec_wrongsecret000000000000000000000000000000000000000";
      const signedMessage = `${timestamp}.${payload}`;
      const v1 = crypto.createHmac("sha256", wrongSecret).update(signedMessage).digest("hex");
      const signatureHeader = `t=${timestamp},v1=${v1}`;

      const res = verifyWebhookSignature(payload, secret, signatureHeader);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("Signature mismatch");
    });

    it("rejects expired timestamp combined signature", () => {
      const staleTimestamp = String(Math.floor((Date.now() - 400_000) / 1000));
      const signedMessage = `${staleTimestamp}.${payload}`;
      const v1 = crypto.createHmac("sha256", secret).update(signedMessage).digest("hex");
      const signatureHeader = `t=${staleTimestamp},v1=${v1}`;

      const res = verifyWebhookSignature(payload, secret, signatureHeader);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/tolerance/);
    });
  });

  describe("Replay Protection", () => {
    it("accepts unique keys and blocks duplicate keys within TTL", () => {
      const protector = new ReplayProtector(10); // 10s TTL
      const key = "wh-sig-123456";

      expect(protector.checkAndRecord(key)).toBe(true); // First attempt: accepted
      expect(protector.checkAndRecord(key)).toBe(false); // Second attempt: rejected
      expect(protector.checkAndRecord("different-key")).toBe(true); // Distinct key: accepted
    });
  });

  describe("Payload Bounds Constant", () => {
    it("defines 1MB payload ceiling", () => {
      expect(MAX_WEBHOOK_PAYLOAD_BYTES).toBe(1024 * 1024);
    });
  });
});
