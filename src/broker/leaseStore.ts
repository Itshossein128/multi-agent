import { randomBytes } from "node:crypto";
import { BrokerError } from "./contract";

/**
 * Durable lease persistence.
 *
 * - Leases outlive the issuing process (PostgreSQL in production).
 * - Consumption is atomic and single-use: concurrent consumers race on one
 *   conditional UPDATE and only one can win.
 * - Raw secret values are NEVER stored in the lease table. A lease holds only
 *   binding metadata; the secret is read from the SecretStore at consume time
 *   and returned once.
 */

export type LeaseStatus = "issued" | "consumed" | "revoked";

/** Persisted lease record. Contains no secret material by construction. */
export interface CredentialLeaseRecord {
  leaseId: string;
  contractVersion: string;
  tenantId: string;
  principalId: string;
  runId: string;
  agentId?: string;
  toolId?: string;
  provider: string;
  alias: string;
  purpose: string;
  audience?: string;
  correlationId?: string;
  issuedAt: number;
  expiresAt: number;
  status: LeaseStatus;
  consumedAt?: number;
  revokedAt?: number;
  revokeReason?: string;
  /** Stable fingerprint of the issue request for idempotent issuance. */
  idempotencyKey?: string;
}

/** Consuming context: every field must match the stored binding exactly. */
export interface LeaseContext {
  tenantId: string;
  principalId: string;
  runId: string;
  provider: string;
  alias: string;
  now: number;
}

export interface LeaseStore {
  create(lease: CredentialLeaseRecord): Promise<void>;
  get(leaseId: string): Promise<CredentialLeaseRecord | null>;
  /** Atomic single-use consumption; throws lease_expired/consumed/revoked/context_mismatch. */
  consume(leaseId: string, context: LeaseContext): Promise<CredentialLeaseRecord>;
  /** Idempotent: repeated revoke of the same lease succeeds. */
  revoke(leaseId: string, reason: string, now: number): Promise<void>;
  deleteExpired(before: number): Promise<number>;
  /** Idempotent issue lookup: returns the lease previously issued with this key. */
  findIdempotent(tenantId: string, idempotencyKey: string): Promise<CredentialLeaseRecord | null>;
}

function assertBinding(record: CredentialLeaseRecord, context: LeaseContext): void {
  if (
    record.tenantId !== context.tenantId ||
    record.principalId !== context.principalId ||
    record.runId !== context.runId ||
    record.provider !== context.provider ||
    record.alias !== context.alias
  ) {
    throw new BrokerError("context_mismatch");
  }
}

function assertConsumeable(record: CredentialLeaseRecord, context: LeaseContext): void {
  if (record.status === "consumed") throw new BrokerError("lease_consumed");
  if (record.status === "revoked") throw new BrokerError("lease_revoked");
  if (record.expiresAt <= context.now) throw new BrokerError("lease_expired");
}

export function generateLeaseId(): string {
  return randomBytes(32).toString("base64url");
}

/** Process-local store. Development/tests only; replaced by PostgresLeaseStore in production. */
export class InMemoryLeaseStore implements LeaseStore {
  private readonly leases = new Map<string, CredentialLeaseRecord>();

  async create(lease: CredentialLeaseRecord): Promise<void> {
    if (this.leases.has(lease.leaseId)) throw new BrokerError("invalid_request");
    this.leases.set(lease.leaseId, { ...lease });
  }

  async get(leaseId: string): Promise<CredentialLeaseRecord | null> {
    const record = this.leases.get(leaseId);
    return record ? { ...record } : null;
  }

  async consume(leaseId: string, context: LeaseContext): Promise<CredentialLeaseRecord> {
    const record = this.leases.get(leaseId);
    if (!record) throw new BrokerError("lease_not_found");
    assertBinding(record, context);
    assertConsumeable(record, context);
    record.status = "consumed";
    record.consumedAt = context.now;
    return { ...record };
  }

  async revoke(leaseId: string, reason: string, now: number): Promise<void> {
    const record = this.leases.get(leaseId);
    if (!record) return; // idempotent
    if (record.status === "revoked") return; // idempotent
    record.status = "revoked";
    record.revokedAt = now;
    record.revokeReason = reason;
  }

  async deleteExpired(before: number): Promise<number> {
    let removed = 0;
    for (const [leaseId, record] of this.leases) {
      if (record.expiresAt < before) {
        this.leases.delete(leaseId);
        removed += 1;
      }
    }
    return removed;
  }

  async findIdempotent(tenantId: string, idempotencyKey: string): Promise<CredentialLeaseRecord | null> {
    for (const record of this.leases.values()) {
      if (record.tenantId === tenantId && record.idempotencyKey === idempotencyKey) return { ...record };
    }
    return null;
  }

  /** Test/ops helper: snapshot of all records (copies). */
  scan(): CredentialLeaseRecord[] {
    return [...this.leases.values()].map((record) => ({ ...record }));
  }

  /** Active-lease count for tenant concurrency limits. */
  async countActive(tenantId: string, now: number): Promise<number> {
    let count = 0;
    for (const record of this.leases.values()) {
      if (record.tenantId === tenantId && record.status === "issued" && record.expiresAt > now) count += 1;
    }
    return count;
  }
}

/** Minimal queryable pool surface (subset of pg.Pool), so tests can inject fakes. */
export interface LeasePgPool {
  query<T = Record<string, unknown>>(config: { text: string; values?: unknown[] }): Promise<{ rows: T[]; rowCount: number | null }>;
}

const LEASE_COLUMNS = [
  "lease_id", "contract_version", "tenant_id", "principal_id", "run_id",
  "agent_id", "tool_id", "provider", "alias", "purpose", "audience",
  "correlation_id", "issued_at", "expires_at", "status", "consumed_at",
  "revoked_at", "revoke_reason", "idempotency_key",
].join(", ");

interface LeaseRow {
  lease_id: string;
  contract_version: string;
  tenant_id: string;
  principal_id: string;
  run_id: string;
  agent_id: string | null;
  tool_id: string | null;
  provider: string;
  alias: string;
  purpose: string;
  audience: string | null;
  correlation_id: string | null;
  issued_at: string | number | Date;
  expires_at: string | number | Date;
  status: string;
  consumed_at: string | number | Date | null;
  revoked_at: string | number | Date | null;
  revoke_reason: string | null;
  idempotency_key: string | null;
}

function toMs(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number(value) : parsed;
}

function mapRow(row: LeaseRow): CredentialLeaseRecord {
  return {
    leaseId: row.lease_id,
    contractVersion: row.contract_version,
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    runId: row.run_id,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.tool_id ? { toolId: row.tool_id } : {}),
    provider: row.provider,
    alias: row.alias,
    purpose: row.purpose,
    ...(row.audience ? { audience: row.audience } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    issuedAt: toMs(row.issued_at),
    expiresAt: toMs(row.expires_at),
    status: row.status as LeaseStatus,
    ...(row.consumed_at ? { consumedAt: toMs(row.consumed_at) } : {}),
    ...(row.revoked_at ? { revokedAt: toMs(row.revoked_at) } : {}),
    ...(row.revoke_reason ? { revokeReason: row.revoke_reason } : {}),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  };
}

/**
 * PostgreSQL lease store.
 *
 * Single-use consumption is a single conditional UPDATE guarded by
 * status = 'issued' AND expires_at > now, so exactly one concurrent consumer
 * can succeed regardless of application-level interleaving.
 */
export class PostgresLeaseStore implements LeaseStore {
  constructor(private readonly pool: LeasePgPool) {}

  async create(lease: CredentialLeaseRecord): Promise<void> {
    const text = `INSERT INTO credential_broker_leases (${LEASE_COLUMNS})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,to_timestamp($13 / 1000.0),to_timestamp($14 / 1000.0),$15,NULL,NULL,NULL,$16)
      ON CONFLICT (idempotency_key, tenant_id) WHERE idempotency_key IS NOT NULL DO NOTHING`;
    const values = [
      lease.leaseId, lease.contractVersion, lease.tenantId, lease.principalId, lease.runId,
      lease.agentId ?? null, lease.toolId ?? null, lease.provider, lease.alias, lease.purpose,
      lease.audience ?? null, lease.correlationId ?? null, lease.issuedAt, lease.expiresAt,
      lease.status, lease.idempotencyKey ?? null,
    ];
    const result = await this.pool.query({ text, values });
    if (result.rowCount === 0) throw new BrokerError("contract_idempotency_conflict");
  }

  async get(leaseId: string): Promise<CredentialLeaseRecord | null> {
    const result = await this.pool.query<LeaseRow>({
      text: `SELECT ${LEASE_COLUMNS} FROM credential_broker_leases WHERE lease_id = $1`,
      values: [leaseId],
    });
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async consume(leaseId: string, context: LeaseContext): Promise<CredentialLeaseRecord> {
    const result = await this.pool.query<LeaseRow>({
      text: `UPDATE credential_broker_leases
             SET status = 'consumed', consumed_at = to_timestamp($2 / 1000.0)
             WHERE lease_id = $1
               AND status = 'issued'
               AND expires_at > to_timestamp($2 / 1000.0)
               AND tenant_id = $3 AND principal_id = $4 AND run_id = $5
               AND provider = $6 AND alias = $7
             RETURNING ${LEASE_COLUMNS}`,
      values: [leaseId, context.now, context.tenantId, context.principalId, context.runId, context.provider, context.alias],
    });
    const row = result.rows[0];
    if (row) return mapRow(row);

    // Conditional UPDATE matched nothing: distinguish the failure precisely.
    const current = await this.get(leaseId);
    if (!current) throw new BrokerError("lease_not_found");
    assertBinding(current, context);
    assertConsumeable(current, context);
    // A concurrent transaction won the race between UPDATE and re-read.
    throw new BrokerError("lease_consumed");
  }

  async revoke(leaseId: string, reason: string, now: number): Promise<void> {
    await this.pool.query({
      text: `UPDATE credential_broker_leases
             SET status = 'revoked', revoked_at = to_timestamp($2 / 1000.0), revoke_reason = $3
             WHERE lease_id = $1 AND status <> 'revoked'`,
      values: [leaseId, now, reason],
    });
  }

  async deleteExpired(before: number): Promise<number> {
    const result = await this.pool.query({
      text: `DELETE FROM credential_broker_leases WHERE expires_at < to_timestamp($1 / 1000.0)`,
      values: [before],
    });
    return result.rowCount ?? 0;
  }

  async findIdempotent(tenantId: string, idempotencyKey: string): Promise<CredentialLeaseRecord | null> {
    const result = await this.pool.query<LeaseRow>({
      text: `SELECT ${LEASE_COLUMNS} FROM credential_broker_leases
             WHERE tenant_id = $1 AND idempotency_key = $2`,
      values: [tenantId, idempotencyKey],
    });
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }
}

/** DDL for the lease table. Idempotent; applied by infrastructure/broker/migrate.cjs. */
export const LEASE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS credential_broker_leases (
  lease_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  tool_id TEXT,
  provider TEXT NOT NULL,
  alias TEXT NOT NULL,
  purpose TEXT NOT NULL,
  audience TEXT,
  correlation_id TEXT,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued','consumed','revoked')),
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  idempotency_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS credential_broker_leases_idem
  ON credential_broker_leases (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS credential_broker_leases_tenant ON credential_broker_leases (tenant_id);
CREATE INDEX IF NOT EXISTS credential_broker_leases_run ON credential_broker_leases (run_id);
CREATE INDEX IF NOT EXISTS credential_broker_leases_expires ON credential_broker_leases (expires_at);
CREATE INDEX IF NOT EXISTS credential_broker_leases_status ON credential_broker_leases (status);
`;

/** Scheduled cleanup of expired leases; safe to run concurrently with requests. */
export function startLeaseCleanup(
  store: LeaseStore,
  options: { intervalMs?: number; onError?: (error: unknown) => void; now?: () => number } = {},
): () => void {
  const interval = options.intervalMs ?? 60_000;
  const now = options.now ?? Date.now;
  const timer = setInterval(() => {
    store.deleteExpired(now()).catch((error) => options.onError?.(error));
  }, interval);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
