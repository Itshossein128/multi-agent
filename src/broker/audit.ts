import { createHash, randomUUID } from "node:crypto";
import { BrokerError } from "./contract";

/**
 * Tamper-evident, queryable audit trail.
 *
 * Append-only: records form a SHA-256 hash chain (each record commits to the
 * previous record's hash), so deletions or edits are detectable by re-hashing.
 *
 * Audit records MUST NEVER contain: secret values, API keys, authorization
 * headers, database URLs, access tokens, refresh tokens, or private keys.
 * The whitelist of fields below is enforced by {@link auditEvent} — unknown
 * fields are rejected rather than serialized.
 */

export type AuditOperation =
  | "lease.issue.requested"
  | "lease.issue.succeeded"
  | "lease.issue.denied"
  | "lease.consume.succeeded"
  | "lease.consume.denied"
  | "lease.expired"
  | "lease.revoked"
  | "secret.rotate.requested"
  | "secret.rotate.succeeded"
  | "secret.rotate.failed";

export type AuditResult = "succeeded" | "denied" | "failed";

export interface AuditRecord {
  eventId: string;
  timestamp: number;
  tenantId: string;
  principalId: string;
  runId?: string;
  agentId?: string;
  toolId?: string;
  provider?: string;
  alias?: string;
  operation: AuditOperation;
  result: AuditResult;
  reasonCode?: string;
  correlationId?: string;
  sourceService: string;
  leaseId?: string;
  /** Tamper-evidence chain. */
  sequence: number;
  previousHash: string;
  recordHash: string;
}

export interface AuditInput {
  tenantId: string;
  principalId: string;
  runId?: string;
  agentId?: string;
  toolId?: string;
  provider?: string;
  alias?: string;
  operation: AuditOperation;
  result: AuditResult;
  reasonCode?: string;
  correlationId?: string;
  sourceService: string;
  leaseId?: string;
}

const GENESIS_HASH = "0".repeat(64);

/** Field whitelist. Anything outside this set throws — it cannot reach storage. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "eventId", "timestamp", "tenantId", "principalId", "runId", "agentId", "toolId",
  "provider", "alias", "operation", "result", "reasonCode", "correlationId",
  "sourceService", "leaseId", "sequence", "previousHash", "recordHash",
]);

/** Belt-and-braces patterns that must never appear in audit field values. */
const FORBIDDEN_VALUE = /(?:sk-|pk-|rk-|AKIA|-----BEGIN)|bearer\s+[a-z0-9._-]+|postgres(ql)?:\/\/|https?:\/\/[^\s]*@[^\s]/i;

export function auditEvent(input: AuditInput, sequence: number, previousHash: string, now: number): AuditRecord {
  const record: AuditRecord = {
    eventId: randomUUID(),
    timestamp: now,
    tenantId: input.tenantId,
    principalId: input.principalId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.toolId ? { toolId: input.toolId } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.alias ? { alias: input.alias } : {}),
    operation: input.operation,
    result: input.result,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    sourceService: input.sourceService,
    ...(input.leaseId ? { leaseId: input.leaseId } : {}),
    sequence,
    previousHash,
    recordHash: "",
  };
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) throw new BrokerError("internal_error");
  }
  for (const value of Object.values(record)) {
    if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) {
      throw new BrokerError("internal_error");
    }
  }
  (record as { recordHash: string }).recordHash = hashRecord(record);
  return record;
}

function hashRecord(record: AuditRecord): string {
  const { recordHash: _ignored, ...rest } = record;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/** Verify the chain over a sequence of records ordered by sequence number. */
export function verifyAuditChain(records: ReadonlyArray<AuditRecord>): boolean {
  let previous = GENESIS_HASH;
  let expectedSequence = 1;
  for (const record of records) {
    if (record.sequence !== expectedSequence) return false;
    if (record.previousHash !== previous) return false;
    const { recordHash, ...rest } = record;
    if (hashRecord(rest as AuditRecord) !== recordHash) return false;
    previous = recordHash;
    expectedSequence += 1;
  }
  return true;
}

export interface AuditQuery {
  tenantId?: string;
  runId?: string;
  operation?: AuditOperation;
  limit?: number;
}

export interface AuditRecorder {
  record(input: AuditInput, now?: number): Promise<AuditRecord>;
  query(query: AuditQuery): Promise<AuditRecord[]>;
}

/** In-memory recorder for development and tests. Chain semantics identical to PG. */
export class InMemoryAuditRecorder implements AuditRecorder {
  private readonly records: AuditRecord[] = [];

  async record(input: AuditInput, now: number = Date.now()): Promise<AuditRecord> {
    const previousHash = this.records.length ? this.records[this.records.length - 1].recordHash : GENESIS_HASH;
    const record = auditEvent(input, this.records.length + 1, previousHash, now);
    this.records.push(record);
    return record;
  }

  async query(query: AuditQuery): Promise<AuditRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    return this.records
      .filter((record) => (query.tenantId ? record.tenantId === query.tenantId : true))
      .filter((record) => (query.runId ? record.runId === query.runId : true))
      .filter((record) => (query.operation ? record.operation === query.operation : true))
      .slice(-limit)
      .reverse();
  }

  all(): ReadonlyArray<AuditRecord> {
    return this.records;
  }
}

/** Minimal queryable pool surface (subset of pg.Pool). */
export interface AuditPgPool {
  query<T = Record<string, unknown>>(config: { text: string; values?: unknown[] }): Promise<{ rows: T[]; rowCount: number | null }>;
}

interface AuditRow {
  event_id: string;
  recorded_at: string | number | Date;
  tenant_id: string;
  principal_id: string;
  run_id: string | null;
  agent_id: string | null;
  tool_id: string | null;
  provider: string | null;
  alias: string | null;
  operation: string;
  result: string;
  reason_code: string | null;
  correlation_id: string | null;
  source_service: string;
  lease_id: string | null;
  sequence: string | number;
  previous_hash: string;
  record_hash: string;
}

function rowToRecord(row: AuditRow): AuditRecord {
  const timestamp = row.recorded_at instanceof Date ? row.recorded_at.getTime() : Date.parse(String(row.recorded_at));
  return {
    eventId: row.event_id,
    timestamp: Number.isNaN(timestamp) ? Number(row.recorded_at) : timestamp,
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.tool_id ? { toolId: row.tool_id } : {}),
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.alias ? { alias: row.alias } : {}),
    operation: row.operation as AuditOperation,
    result: row.result as AuditResult,
    ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    sourceService: row.source_service,
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    sequence: Number(row.sequence),
    previousHash: row.previous_hash,
    recordHash: row.record_hash,
  };
}

/**
 * PostgreSQL audit recorder.
 *
 * The chain head is the highest existing sequence. The UNIQUE constraint on
 * sequence is the serialization backstop: two concurrent appends cannot both
 * claim the same sequence, so a losing writer fails loudly instead of forking
 * the chain. The table is append-only by trigger (see AUDIT_TABLE_DDL):
 * UPDATE and DELETE are blocked at the database layer, making records
 * immutable for ordinary principals.
 */
export class PostgresAuditRecorder implements AuditRecorder {
  constructor(private readonly pool: AuditPgPool) {}

  async record(input: AuditInput, now: number = Date.now()): Promise<AuditRecord> {
    const head = await this.pool.query<{ sequence: string | number; record_hash: string }>({
      text: `SELECT sequence, record_hash FROM credential_broker_audit ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
    });
    const previous = head.rows[0];
    const sequence = previous ? Number(previous.sequence) + 1 : 1;
    const previousHash = previous ? previous.record_hash : GENESIS_HASH;
    const record = auditEvent(input, sequence, previousHash, now);
    await this.pool.query({
      text: `INSERT INTO credential_broker_audit
        (event_id, recorded_at, tenant_id, principal_id, run_id, agent_id, tool_id,
         provider, alias, operation, result, reason_code, correlation_id,
         source_service, lease_id, sequence, previous_hash, record_hash)
        VALUES ($1,to_timestamp($2 / 1000.0),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      values: [
        record.eventId, record.timestamp, record.tenantId, record.principalId,
        record.runId ?? null, record.agentId ?? null, record.toolId ?? null,
        record.provider ?? null, record.alias ?? null, record.operation, record.result,
        record.reasonCode ?? null, record.correlationId ?? null, record.sourceService,
        record.leaseId ?? null, record.sequence, record.previousHash, record.recordHash,
      ],
    });
    return record;
  }

  async query(query: AuditQuery): Promise<AuditRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.tenantId) { values.push(query.tenantId); conditions.push(`tenant_id = $${values.length}`); }
    if (query.runId) { values.push(query.runId); conditions.push(`run_id = $${values.length}`); }
    if (query.operation) { values.push(query.operation); conditions.push(`operation = $${values.length}`); }
    values.push(limit);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<AuditRow>({
      text: `SELECT event_id, recorded_at, tenant_id, principal_id, run_id, agent_id, tool_id,
                    provider, alias, operation, result, reason_code, correlation_id,
                    source_service, lease_id, sequence, previous_hash, record_hash
             FROM credential_broker_audit ${where}
             ORDER BY sequence DESC LIMIT $${values.length}`,
      values,
    });
    return result.rows.map(rowToRecord);
  }
}

export const AUDIT_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS credential_broker_audit (
  event_id TEXT PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  run_id TEXT,
  agent_id TEXT,
  tool_id TEXT,
  provider TEXT,
  alias TEXT,
  operation TEXT NOT NULL,
  result TEXT NOT NULL,
  reason_code TEXT,
  correlation_id TEXT,
  source_service TEXT NOT NULL,
  lease_id TEXT,
  sequence BIGINT NOT NULL UNIQUE,
  previous_hash TEXT NOT NULL,
  record_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credential_broker_audit_tenant ON credential_broker_audit (tenant_id);
CREATE INDEX IF NOT EXISTS credential_broker_audit_run ON credential_broker_audit (run_id);
CREATE INDEX IF NOT EXISTS credential_broker_audit_operation ON credential_broker_audit (operation);
CREATE OR REPLACE FUNCTION credential_broker_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credential_broker_audit is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS credential_broker_audit_no_rewrite ON credential_broker_audit;
CREATE TRIGGER credential_broker_audit_no_rewrite
  BEFORE UPDATE OR DELETE ON credential_broker_audit
  FOR EACH ROW EXECUTE FUNCTION credential_broker_audit_immutable();
`;
