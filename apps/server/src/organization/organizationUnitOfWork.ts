import type { PgPool } from "../../../../src/memory/infrastructure";
import type { StudioStore } from "../../../../src/studio/contracts";
import { InMemoryStudioStore } from "../../../../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../../../../src/studio/infrastructure/postgres-studio-store";
import { ApiError } from "../api/shared/http";
import { InMemoryOrganizationStore, PostgresOrganizationStore, type OrganizationStore } from "./organizationStore";

type Operation<T> = (stores: { studio: StudioStore; organization: OrganizationStore }) => Promise<T>;
export interface OrganizationUnitOfWork { run<T>(operation: Operation<T>): Promise<T> }

export class PostgresOrganizationUnitOfWork implements OrganizationUnitOfWork {
  constructor(private readonly pool: PgPool) {}
  async run<T>(operation: Operation<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation({ studio: new PostgresStudioStore(this.pool, client), organization: new PostgresOrganizationStore(this.pool, client) });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally { client.release(); }
  }
}

export class InMemoryOrganizationUnitOfWork implements OrganizationUnitOfWork {
  constructor(private readonly studio: InMemoryStudioStore, private readonly organization: InMemoryOrganizationStore) {}
  async run<T>(operation: Operation<T>): Promise<T> {
    const snapshot = this.organization.snapshot();
    try {
      return await this.studio.transaction(studio => operation({ studio, organization: this.organization }));
    } catch (error) {
      this.organization.restore(snapshot);
      throw error;
    }
  }
}

export class UnavailableOrganizationUnitOfWork implements OrganizationUnitOfWork {
  async run<T>(_operation: Operation<T>): Promise<T> {
    throw new ApiError(503, "Atomic organization operations are not configured");
  }
}

export function defaultOrganizationUnitOfWork(studio: StudioStore, organization: OrganizationStore): OrganizationUnitOfWork {
  return studio instanceof InMemoryStudioStore && organization instanceof InMemoryOrganizationStore
    ? new InMemoryOrganizationUnitOfWork(studio, organization)
    : new UnavailableOrganizationUnitOfWork();
}
