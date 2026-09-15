import { Pool } from "pg";
import type { CredentialGateway } from "../security/credentialGateway";
import { credentialEnvironmentName, credentialGatewayFromEnvironment } from "../security/credentialGateway";
import type { ToolExecutionInput, ToolExecutor } from "./types";

interface DatabaseClient { query<T = Record<string, unknown>>(config: string | { text: string; values?: unknown[] }): Promise<{ rows: T[]; rowCount: number | null; fields?: Array<{ name: string }> }>; release(): void; }
interface DatabasePool { connect(): Promise<DatabaseClient>; end(): Promise<void>; }

/** Read-only PostgreSQL execution. The connection URL is server-owned and leased, never tool-configured. */
export class DatabaseToolExecutor implements ToolExecutor {
  constructor(
    private readonly gateway: CredentialGateway = credentialGatewayFromEnvironment(),
    private readonly poolFactory: (connectionString: string) => DatabasePool = (connectionString) => new Pool({ connectionString, max: 1, idleTimeoutMillis: 5_000 }) as unknown as DatabasePool,
  ) {}

  async execute({ tool, input, signal, runId, credentialPrincipal }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const alias = serverAlias(tool.configuration.connection ?? tool.configuration.provider);
    const query = String(input.query ?? tool.configuration.query ?? "").trim();
    const parameters = input.parameters === undefined ? [] : input.parameters;
    if (!query) throw new Error(`Database tool "${tool.name}" requires input.query or configuration.query.`);
    if (!credentialPrincipal || !runId) throw new Error("Database tool requires an authenticated run context.");
    if (!Array.isArray(parameters) || parameters.length > 100 || parameters.some((value) => !isSqlParameter(value))) throw new Error("Database parameters must be at most 100 scalar values.");
    assertReadOnlyQuery(query);
    const maxRows = boundedRows(tool.configuration.maxRows);
    const lease = await this.gateway.issue({ provider: "database", alias, tenantId: credentialPrincipal.tenantId, principalId: credentialPrincipal.principalId, runId });
    const connectionString = await this.gateway.consume(lease, { provider: "database", alias, tenantId: credentialPrincipal.tenantId, principalId: credentialPrincipal.principalId, runId });
    if (!connectionString) throw new Error("Database credential gateway returned no connection string.");
    const pool = this.poolFactory(connectionString);
    const client = await pool.connect();
    const statementTimeout = boundedTimeout(tool.configuration.statementTimeoutMs);
    try {
      signal?.throwIfAborted();
      await client.query("BEGIN");
      await client.query(`SET LOCAL TRANSACTION READ ONLY; SET LOCAL statement_timeout = ${statementTimeout}`);
      const boundedQuery = `SELECT * FROM (${query}) AS __agent_query LIMIT ${maxRows}`;
      const result = await client.query({ text: boundedQuery, values: parameters });
      await client.query("COMMIT");
      signal?.throwIfAborted();
      return { rows: result.rows.slice(0, maxRows), rowCount: result.rowCount ?? result.rows.length, columns: result.fields?.map((field) => field.name) ?? [] };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original database error */ }
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  }
}

function serverAlias(value: string | number | boolean | undefined): string {
  const alias = String(value ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(alias)) throw new Error("Database tool requires a safe server-owned configuration.connection alias.");
  return alias;
}

function assertReadOnlyQuery(query: string) {
  if (query.includes("\0") || query.includes(";") || /(?:^|\s)(?:insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|copy|call|do|listen|notify|set|begin|commit|rollback|vacuum|refresh|lock|for\s+update)(?:\s|$)/i.test(query) || !/^(select|with)\b/i.test(query)) {
    throw new Error("Database tool only permits a single read-only SELECT/WITH query.");
  }
}

function isSqlParameter(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function boundedRows(value: string | number | boolean | undefined) {
  const parsed = Number(value ?? 100);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_000 ? parsed : 100;
}

function boundedTimeout(value: string | number | boolean | undefined) {
  const parsed = Number(value ?? 10_000);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 60_000 ? parsed : 10_000;
}

export function databaseCredentialEnvironmentName(alias: string) {
  return credentialEnvironmentName({ provider: "database", alias });
}
