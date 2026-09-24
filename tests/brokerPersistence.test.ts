import { randomUUID } from "node:crypto";
import { AUDIT_TABLE_DDL, InMemoryAuditRecorder, PostgresAuditRecorder, verifyAuditChain, type AuditRecord } from "../src/broker/audit";
import { LEASE_TABLE_DDL, PostgresLeaseStore, startLeaseCleanup, type CredentialLeaseRecord } from "../src/broker/leaseStore";
import { InMemorySecretStore, VaultSecretStore } from "../src/broker/secretStore";
import type { LeaseContext } from "../src/broker/leaseStore";

/**
 * PostgreSQL lease/audit persistence and fake-Vault integration.
 *
 * The PostgreSQL suite follows the repo convention: enabled only when
 * MEMORY_TEST_DATABASE_URL points at a disposable database; each run creates
 * its own schema and drops it afterward. Without the variable these tests are
 * skipped and the same behaviors remain covered by the in-memory suites.
 *
 * The Vault suite uses a fake HTTP adapter — no real Vault, no real secret.
 */
const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function lease(overrides: Partial<CredentialLeaseRecord> = {}): CredentialLeaseRecord {
  const now = Date.now();
  return {
    leaseId: randomUUID().replace(/-/g, "") + "lease0000000000000000000000",
    contractVersion: "1",
    tenantId: "tenant-a",
    principalId: "user-a",
    runId: "run-a",
    provider: "database",
    alias: "main",
    purpose: "database",
    issuedAt: now,
    expiresAt: now + 30_000,
    status: "issued",
    ...overrides,
  };
}

function context(overrides: Partial<LeaseContext> = {}): LeaseContext {
  return {
    tenantId: "tenant-a",
    principalId: "user-a",
    runId: "run-a",
    provider: "database",
    alias: "main",
    now: Date.now(),
    ...overrides,
  };
}

describePostgres("PostgreSQL lease store persistence", () => {
  let pool: any;
  let schema: string;
  let store: PostgresLeaseStore;

  beforeAll(async () => {
    const { Pool } = require("pg");
    schema = `broker_${randomUUID().replace(/-/g, "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 });
    await pool.query(LEASE_TABLE_DDL);
    await pool.query(AUDIT_TABLE_DDL);
    store = new PostgresLeaseStore(pool);
  });

  afterAll(async () => {
    if (!pool) return;
    const { Pool } = require("pg");
    const admin = new Pool({ connectionString: databaseUrl });
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  test("DDL creates the required indexes for tenant, run, expiry, and status", async () => {
    const indexes = await pool.query({
      text: `SELECT indexname FROM pg_indexes WHERE tablename = 'credential_broker_leases'`,
    });
    const names = indexes.rows.map((row: { indexname: string }) => row.indexname);
    expect(names).toEqual(expect.arrayContaining([
      "credential_broker_leases_tenant",
      "credential_broker_leases_run",
      "credential_broker_leases_expires",
      "credential_broker_leases_status",
    ]));
  });

  test("concurrent consumption allows exactly one success", async () => {
    const record = lease({ leaseId: randomUUID().replace(/-/g, "") + "concurrent00000000000000000" });
    await store.create(record);
    const attempts = Array.from({ length: 10 }, () =>
      store.consume(record.leaseId, context()).then(
        () => "success" as const,
        (error: unknown) => (error as { code?: string }).code ?? "unknown",
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result === "success")).toHaveLength(1);
    expect(results.filter((result) => result === "lease_consumed" || result === "lease_expired")).toHaveLength(9);
  });

  test("valid leases survive an application restart (fresh store, same database)", async () => {
    const record = lease({ leaseId: randomUUID().replace(/-/g, "") + "restart0000000000000000000" });
    await store.create(record);

    // "Restart": brand-new store instance over the same pool/schema.
    const restarted = new PostgresLeaseStore(pool);
    const loaded = await restarted.get(record.leaseId);
    expect(loaded).not.toBeNull();
    expect(loaded?.tenantId).toBe("tenant-a");
    expect(loaded?.status).toBe("issued");

    const secret = await restarted.consume(record.leaseId, context());
    expect(secret.status).toBe("consumed");
    // Second consumption after restart still fails.
    await expect(restarted.consume(record.leaseId, context())).rejects.toMatchObject({ code: "lease_consumed" });
  });

  test("expired leases are not consumable and cleanup deletes them", async () => {
    const record = lease({
      leaseId: randomUUID().replace(/-/g, "") + "expired000000000000000000000",
      expiresAt: Date.now() - 1_000,
    });
    await store.create(record);
    await expect(store.consume(record.leaseId, context())).rejects.toMatchObject({ code: "lease_expired" });

    const removed = await store.deleteExpired(Date.now());
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await store.get(record.leaseId)).toBeNull();
  });

  test("wrong-context consumption is rejected by the atomic UPDATE itself", async () => {
    const record = lease({ leaseId: randomUUID().replace(/-/g, "") + "context00000000000000000000" });
    await store.create(record);
    await expect(store.consume(record.leaseId, context({ tenantId: "tenant-b", principalId: "user-b", runId: "run-b" })))
      .rejects.toMatchObject({ code: "context_mismatch" });
    await expect(store.consume(record.leaseId, context({ runId: "run-other" })))
      .rejects.toMatchObject({ code: "context_mismatch" });
    // Owner can still consume: foreign attempts did not burn the lease.
    await expect(store.consume(record.leaseId, context())).resolves.toMatchObject({ status: "consumed" });
  });

  test("revoke is idempotent and blocks consumption", async () => {
    const record = lease({ leaseId: randomUUID().replace(/-/g, "") + "revoked00000000000000000000" });
    await store.create(record);
    await store.revoke(record.leaseId, "test", Date.now());
    await store.revoke(record.leaseId, "test", Date.now());
    await expect(store.consume(record.leaseId, context())).rejects.toMatchObject({ code: "lease_revoked" });
    expect((await store.get(record.leaseId))?.status).toBe("revoked");
  });

  test("idempotent issue lookup is tenant-scoped", async () => {
    const record = lease({ leaseId: randomUUID().replace(/-/g, "") + "idem00000000000000000000000", idempotencyKey: "key-abc-0001" });
    await store.create(record);
    expect((await store.findIdempotent("tenant-a", "key-abc-0001"))?.leaseId).toBe(record.leaseId);
    expect(await store.findIdempotent("tenant-b", "key-abc-0001")).toBeNull();
    // A duplicate (tenant, key) insert is rejected rather than silently duplicated.
    await expect(store.create(lease({ leaseId: "different-lease-id-00000000000000000", idempotencyKey: "key-abc-0001" })))
      .rejects.toMatchObject({ code: "contract_idempotency_conflict" });
  });

  test("scheduled cleanup runs and is stoppable", async () => {
    const record = lease({
      leaseId: randomUUID().replace(/-/g, "") + "scheduled0000000000000000000",
      expiresAt: Date.now() - 5_000,
    });
    await store.create(record);
    let errors = 0;
    const stop = startLeaseCleanup(store, { intervalMs: 25, onError: () => { errors += 1; }, now: Date.now });
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop();
    expect(errors).toBe(0);
    expect(await store.get(record.leaseId)).toBeNull();
  });
});

describePostgres("PostgreSQL audit trail", () => {
  let pool: any;
  let schema: string;
  let recorder: PostgresAuditRecorder;

  beforeAll(async () => {
    const { Pool } = require("pg");
    schema = `broker_audit_${randomUUID().replace(/-/g, "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 });
    await pool.query(AUDIT_TABLE_DDL);
    recorder = new PostgresAuditRecorder(pool);
  });

  afterAll(async () => {
    if (!pool) return;
    const { Pool } = require("pg");
    const admin = new Pool({ connectionString: databaseUrl });
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  test("records chain in sequence and are queryable by tenant and run", async () => {
    await recorder.record({ tenantId: "tenant-a", principalId: "user-a", runId: "run-a", operation: "lease.issue.requested", result: "succeeded", sourceService: "test" });
    await recorder.record({ tenantId: "tenant-a", principalId: "user-a", runId: "run-a", operation: "lease.issue.succeeded", result: "succeeded", sourceService: "test" });
    await recorder.record({ tenantId: "tenant-b", principalId: "user-b", runId: "run-b", operation: "lease.issue.requested", result: "succeeded", sourceService: "test" });

    const forTenant = await recorder.query({ tenantId: "tenant-a" });
    expect(forTenant).toHaveLength(2);
    const forRun = await recorder.query({ runId: "run-b" });
    expect(forRun).toHaveLength(1);
    expect(forRun[0].tenantId).toBe("tenant-b");
  });

  test("hash chain verifies against persisted records", async () => {
    const all = await pool.query({
      text: `SELECT sequence, previous_hash, record_hash FROM credential_broker_audit ORDER BY sequence ASC`,
    });
    expect(all.rows.length).toBeGreaterThanOrEqual(3);
    // Reconstruct full records for chain verification.
    const full = await recorder.query({ limit: 1000 });
    const ordered = [...full].reverse() as AuditRecord[];
    expect(verifyAuditChain(ordered)).toBe(true);
  });

  test("audit rows are immutable: UPDATE and DELETE are blocked by trigger", async () => {
    await expect(pool.query({
      text: `UPDATE credential_broker_audit SET tenant_id = 'tampered' WHERE sequence = 1`,
    })).rejects.toThrow(/append-only/);
    await expect(pool.query({
      text: `DELETE FROM credential_broker_audit WHERE sequence = 1`,
    })).rejects.toThrow(/append-only/);
  });

  test("audit records never contain secret-looking values", async () => {
    const events = await recorder.query({ limit: 1000 });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/Bearer /);
  });
});

describe("fake Vault secret store", () => {
  function vaultFetch(handler: (path: string, init?: { method?: string; headers?: Record<string, string> }) => { ok: boolean; status: number; body?: unknown }) {
    return async (path: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const result = handler(path, init);
      return {
        ok: result.ok,
        status: result.status,
        async json() { return result.body ?? {}; },
      };
    };
  }

  test("reads a tenant-scoped secret from the KV v2 response shape", async () => {
    const seen: string[] = [];
    const store = new VaultSecretStore({
      baseUrl: "https://vault.internal",
      token: "fake-vault-token",
      fetchImpl: vaultFetch((path, init) => {
        seen.push(path);
        expect(init?.headers?.["X-Vault-Token"]).toBe("fake-vault-token");
        return { ok: true, status: 200, body: { data: { data: { value: "fake-db-secret" }, metadata: { version: 3 } } } };
      }),
    });
    const secret = await store.getSecret({ tenantId: "tenant-a", provider: "database", alias: "main" });
    expect(secret.value).toBe("fake-db-secret");
    expect(secret.version).toBe("3");
    expect(seen[0]).toBe("https://vault.internal/v1/data/secret/tenant-a/database/main");
    // Tenant scoping: another tenant reads its own path.
    await store.getSecret({ tenantId: "tenant-b", provider: "database", alias: "main" });
    expect(seen[1]).toContain("/tenant-b/");
  });

  test("404 means not provisioned; 5xx and network errors fail closed", async () => {
    const notFound = new VaultSecretStore({
      baseUrl: "https://vault.internal", token: "t",
      fetchImpl: vaultFetch(() => ({ ok: false, status: 404 })),
    });
    await expect(notFound.getSecret({ tenantId: "t", provider: "database", alias: "x" }))
      .rejects.toMatchObject({ code: "credential_not_provisioned" });

    const broken = new VaultSecretStore({
      baseUrl: "https://vault.internal", token: "t",
      fetchImpl: vaultFetch(() => ({ ok: false, status: 503 })),
    });
    await expect(broken.getSecret({ tenantId: "t", provider: "database", alias: "x" }))
      .rejects.toMatchObject({ code: "secretstore_unavailable" });

    const offline = new VaultSecretStore({
      baseUrl: "https://vault.internal", token: "t",
      fetchImpl: async () => { throw new TypeError("connect ECONNREFUSED"); },
    });
    const error = await offline.getSecret({ tenantId: "t", provider: "database", alias: "x" }).catch((caught: unknown) => caught);
    expect((error as { code?: string }).code).toBe("secretstore_unavailable");
    // The network error text (which could embed an internal URL) is swallowed.
    expect(String(error)).not.toContain("ECONNREFUSED");
    expect(String(error)).not.toContain("vault.internal");
  });

  test("expired secrets are refused", async () => {
    const store = new VaultSecretStore({
      baseUrl: "https://vault.internal", token: "t",
      fetchImpl: vaultFetch(() => ({
        ok: true, status: 200,
        body: { data: { data: { value: "fake-secret", expires_at: Date.now() - 1 } } },
      })),
    });
    await expect(store.getSecret({ tenantId: "t", provider: "database", alias: "x" }))
      .rejects.toMatchObject({ code: "secret_unavailable" });
  });

  test("shared credentials require explicit policy and fall back to _shared scope", async () => {
    const paths: string[] = [];
    const makeStore = (shared: Set<string>) => new VaultSecretStore({
      baseUrl: "https://vault.internal", token: "t",
      sharedPolicy: { allowedSharedAliases: shared },
      fetchImpl: vaultFetch((path) => {
        paths.push(path);
        return path.includes("/_shared/")
          ? { ok: true, status: 200, body: { data: { data: { value: "shared-fake-secret" } } } }
          : { ok: false, status: 404 };
      }),
    });
    // Denied by default: no policy entry means no shared fallback.
    await expect(makeStore(new Set()).getSecret({ tenantId: "t", provider: "search", alias: "global" }))
      .rejects.toMatchObject({ code: "credential_not_provisioned" });
    expect(paths.every((path) => !path.includes("/_shared/"))).toBe(true);

    // Explicitly allowed: falls back to the _shared scope only after tenant miss.
    const allowed = await makeStore(new Set(["search/global"])).getSecret({ tenantId: "t", provider: "search", alias: "global" });
    expect(allowed.value).toBe("shared-fake-secret");
    expect(paths[paths.length - 1]).toContain("/_shared/");
  });

  test("vault URL with embedded credentials or query strings is rejected", () => {
    for (const baseUrl of ["https://user:pass@vault.internal", "https://vault.internal?x=1", "ftp://vault.internal", "not a url"]) {
      expect(() => new VaultSecretStore({ baseUrl, token: "t" })).toThrow();
    }
    expect(() => new VaultSecretStore({ baseUrl: "https://vault.internal", token: "" })).toThrow();
  });

  test("in-memory store honors tenant scoping, revoke, and expiry", async () => {
    const store = new InMemorySecretStore([
      { tenantId: "tenant-a", provider: "database", alias: "main", value: "secret-a" },
      { tenantId: "tenant-b", provider: "database", alias: "main", value: "secret-b" },
      { tenantId: "tenant-a", provider: "search", alias: "expiring", value: "soon", expiresAt: Date.now() - 1 },
    ]);
    expect((await store.getSecret({ tenantId: "tenant-a", provider: "database", alias: "main" })).value).toBe("secret-a");
    expect((await store.getSecret({ tenantId: "tenant-b", provider: "database", alias: "main" })).value).toBe("secret-b");
    await expect(store.getSecret({ tenantId: "tenant-c", provider: "database", alias: "main" }))
      .rejects.toMatchObject({ code: "credential_not_provisioned" });
    await expect(store.getSecret({ tenantId: "tenant-a", provider: "search", alias: "expiring" }))
      .rejects.toMatchObject({ code: "secret_unavailable" });
    await store.revoke({ tenantId: "tenant-a", provider: "database", alias: "main" });
    await expect(store.getSecret({ tenantId: "tenant-a", provider: "database", alias: "main" }))
      .rejects.toMatchObject({ code: "secret_unavailable" });
  });
});
