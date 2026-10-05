import crypto from "node:crypto";

export const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
export const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

function getMasterKey(): Buffer {
  const envKey = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!envKey || envKey.trim().length < 32) {
    throw new Error(
      "WEBHOOK_ENCRYPTION_KEY must be configured with at least 32 characters to protect webhook secrets at rest (fail-closed)."
    );
  }
  return crypto.createHash("sha256").update(envKey.trim()).digest();
}

/**
 * Generate a cryptographically secure webhook signing secret.
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("hex")}`;
}

/**
 * Encrypt a webhook secret for secure storage at rest.
 * Uses AES-256-GCM with a random 12-byte IV.
 */
export function encryptWebhookSecret(secret: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a stored webhook secret.
 * Rejects plaintext stored secrets (must have 'enc:' prefix).
 */
export function decryptWebhookSecret(storedSecret: string): string {
  if (!storedSecret || !storedSecret.startsWith("enc:")) {
    throw new Error("Plaintext webhook secrets are rejected. Secrets must be encrypted with 'enc:' prefix.");
  }
  const parts = storedSecret.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted secret format");
  }
  const [, ivHex, tagHex, dataHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Check if a timestamp is within the freshness window (defaults to 300s = 5 minutes).
 */
export function isTimestampFresh(
  timestamp: string | number,
  toleranceSeconds: number = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
): { fresh: boolean; error?: string } {
  let tsMs: number;
  if (typeof timestamp === "number") {
    // If timestamp is in seconds (< 1e11), convert to ms
    tsMs = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  } else {
    // Check if numeric string
    if (/^\d+$/.test(timestamp)) {
      const num = Number(timestamp);
      tsMs = num < 1e11 ? num * 1000 : num;
    } else {
      tsMs = Date.parse(timestamp);
    }
  }

  if (Number.isNaN(tsMs)) {
    return { fresh: false, error: "Invalid timestamp format" };
  }

  const now = Date.now();
  const diffMs = Math.abs(now - tsMs);
  const maxDiffMs = toleranceSeconds * 1000;

  if (diffMs > maxDiffMs) {
    return {
      fresh: false,
      error: `Timestamp out of bounds (difference of ${Math.round(diffMs / 1000)}s exceeds ${toleranceSeconds}s tolerance)`,
    };
  }

  return { fresh: true };
}

/**
 * Verify HMAC-SHA256 webhook signature.
 * Requires signed timestamp in HMAC input (`${timestamp}.${rawBody}`).
 * Unsigned direct body HMAC is rejected.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  secret: string,
  signatureHeader: string,
  timestampHeader?: string,
): { valid: boolean; reason?: string } {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: "Missing signature or secret" };
  }

  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");

  // Check if header is formatted like Stripe: t=12345,v1=abcdef...
  let receivedHex = signatureHeader.trim();
  let headerTimestamp: string | undefined;

  if (receivedHex.includes("t=") && receivedHex.includes("v1=")) {
    const parts = receivedHex.split(",");
    for (const part of parts) {
      const [k, v] = part.trim().split("=");
      if (k === "t") headerTimestamp = v;
      if (k === "v1") receivedHex = v;
    }
  } else if (receivedHex.startsWith("sha256=")) {
    receivedHex = receivedHex.slice("sha256=".length);
  }

  const activeTimestamp = timestampHeader || headerTimestamp;
  if (!activeTimestamp) {
    return {
      valid: false,
      reason:
        "Missing required timestamp in signature header (t=...) or X-Webhook-Timestamp (unsigned direct body HMAC is rejected)",
    };
  }

  const freshness = isTimestampFresh(activeTimestamp);
  if (!freshness.fresh) {
    return { valid: false, reason: freshness.error };
  }

  // Calculate HMAC candidate: HMAC over `${activeTimestamp}.${rawBody}`
  const prefix = Buffer.from(`${activeTimestamp}.`, "utf8");
  const combined = Buffer.concat([prefix, rawBuffer]);
  const expectedHmac = crypto.createHmac("sha256", secret).update(combined).digest("hex");

  // Constant-time compare
  const receivedBuf = Buffer.from(receivedHex, "hex");
  if (receivedBuf.length !== 32) {
    return { valid: false, reason: "Invalid signature length" };
  }

  const expectedBuf = Buffer.from(expectedHmac, "hex");
  if (expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
    return { valid: true };
  }

  return { valid: false, reason: "Signature mismatch" };
}

/**
 * In-memory replay protector with automatic sliding cache eviction.
 */
export class ReplayProtector {
  private seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Check if a key was already seen.
   * If not seen, records it and returns true (accepted).
   * If already seen, returns false (rejected as duplicate/replay).
   */
  public checkAndRecord(key: string): boolean {
    this.evict();
    if (this.seen.has(key)) {
      return false; // Replay!
    }
    this.seen.set(key, Date.now());
    return true;
  }

  public clear(): void {
    this.seen.clear();
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seen.entries()) {
      if (now - timestamp > this.ttlMs) {
        this.seen.delete(key);
      }
    }
  }
}

export const defaultReplayProtector = new ReplayProtector();
