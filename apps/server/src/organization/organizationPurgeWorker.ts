import { nowIso } from "@multi-agent/types";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { OrganizationStore } from "./organizationStore";
import type { BudgetStore } from "../budgets/budgetStore";
import type { RunStoreContract } from "../runtime/store/contracts";
import type { MemoryStore } from "../../../../src/memory/contracts";
import type { LeaseStore } from "../../../../src/broker/leaseStore";
import type { SecretStore } from "../../../../src/broker/secretStore";
import { rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { withOrganization, organizationStorage } from "../../../../src/studio/infrastructure/withOrganization";
import type { PgPool } from "../../../../src/memory/infrastructure";
import { log } from "../logging";

export interface TenantCredentialCleanup {
  purgeTenantCredentials(tenantId: string): Promise<void>;
}

export class OrganizationCleanupUnavailableError extends Error {
  constructor(missing: string[]) {
    super(`Organization cleanup unavailable: ${missing.join(", ")}`);
  }
}

export interface OrganizationPurgeDependencies {
  studioStore: StudioStore;
  organizationStore?: OrganizationStore;
  budgetStore?: BudgetStore;
  runStore?: RunStoreContract;
  memoryStore?: Pick<MemoryStore, "deleteTenantMemories">;
  leaseStore?: LeaseStore;
  secretStore?: SecretStore;
  workspaceStorageRoot?: string;
  credentialCleanup?: TenantCredentialCleanup;
  workspaceCleanup?: (organizationId: string) => Promise<void>;
  discoveryPool?: PgPool;
}

export interface PurgeResult {
  status: "completed";
  organizationId: string;
  purgedAt: string;
}

export class OrganizationPurgeWorker {
  private timer?: NodeJS.Timeout;
  private polling?: Promise<number>;
  constructor(private readonly deps: OrganizationPurgeDependencies) {}

  assertReady(): void {
    const missing = [
      !this.deps.runStore?.purgeTenantRuns && "runStore",
      !this.deps.credentialCleanup && !this.deps.secretStore?.deleteTenantSecrets && "secretStore",
      !this.deps.credentialCleanup && !this.deps.leaseStore?.deleteTenantLeases && "leaseStore",
      !this.deps.memoryStore?.deleteTenantMemories && "memoryStore",
      !this.deps.organizationStore?.purgeTenantGoals && "organizationStore",
      !this.deps.budgetStore?.purgeTenantBudgets && "budgetStore",
      !this.deps.workspaceCleanup && !this.deps.workspaceStorageRoot && "workspaceStorageRoot",
    ].filter((item): item is string => typeof item === "string");
    if (missing.length) throw new OrganizationCleanupUnavailableError(missing);
  }

  startRecovery(intervalMs = 5_000): void {
    if (this.timer) return;
    const poll = () => { void this.pollOnce().catch(() => log.warn("organization.purge.discovery_failed", {})); };
    poll();
    this.timer = setInterval(poll, intervalMs);
    this.timer.unref?.();
  }

  async stopRecovery(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.polling;
  }

  pollOnce(): Promise<number> {
    if (this.polling) return this.polling;
    this.polling = this.recoverPending().finally(() => { this.polling = undefined; });
    return this.polling;
  }

  private async recoverPending(): Promise<number> {
    this.assertReady();
    let completed = 0;
    for (const id of await this.findPendingPurges()) {
      try { await this.resumePurge(id); completed++; }
      catch { log.warn("organization.purge.retry_pending", { organizationId: id }); }
    }
    return completed;
  }

  async findPendingPurges(): Promise<string[]> {
    if (this.deps.discoveryPool) {
      const result = await this.deps.discoveryPool.query("SELECT organization_id FROM studio_pending_organization_purges()");
      return result.rows.map(row => String(row.organization_id));
    }
    const store = this.deps.studioStore as unknown as {
      organizations?: Map<string, { status: string }>;
      query?: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }>;
    };
    if (store.organizations instanceof Map) {
      const pending: string[] = [];
      for (const [id, org] of store.organizations.entries()) {
        if (org.status === "deleting") pending.push(id);
      }
      return pending;
    }
    if (typeof store.query === "function") {
      const result = await store.query("SELECT id FROM studio_organizations WHERE status = 'deleting'");
      return result.rows.map((r) => r.id);
    }
    return [];
  }

  async resumePurge(organizationId: string): Promise<PurgeResult> {
    return this.purgeOrganization(organizationId);
  }

  async purgeOrganization(organizationId: string): Promise<PurgeResult> {
    if (!organizationId.trim()) throw new Error("Organization id is required");
    // Configuration failures must not change a live organization or erase runs.
    this.assertReady();
    const pool = (this.deps.studioStore as any).getPool?.();
    // Admission denial commits before cleanup. Failure must leave a resumable marker.
    await organizationStorage.run(Object.freeze({organizationId, principalKind: "service" as const, source: "organization.delete"}), async () => {
      if (pool) await withOrganization(pool, organizationId, "service", () => this.deps.studioStore.updateOrganizationStatus(organizationId, "deleting"));
      else await this.deps.studioStore.updateOrganizationStatus(organizationId, "deleting");
    });
    await this.cleanup(organizationId);
    return { status: "completed", organizationId, purgedAt: nowIso() };
  }

  private async cleanup(organizationId: string): Promise<void> {
    const pool = (this.deps.studioStore as any).getPool?.();
    return organizationStorage.run(Object.freeze({organizationId, principalKind: "service" as const, source: "organization.cleanup"}), async () => {
    const scoped = <T>(fn: () => Promise<T>): Promise<T> => pool ? withOrganization(pool, organizationId, "service", fn) : fn();

    // 2. Cancel and purge runs
    await this.deps.runStore?.purgeTenantRuns?.(organizationId);

    // 3. Delete secrets in SecretStore
    if (this.deps.credentialCleanup) {
      await this.deps.credentialCleanup.purgeTenantCredentials(organizationId);
    } else if (this.deps.secretStore && typeof this.deps.secretStore.deleteTenantSecrets === "function") {
      await this.deps.secretStore.deleteTenantSecrets(organizationId);
    }

    // 4. Delete leases in LeaseStore (credential_broker_audit rows are preserved per Q2)
    if (!this.deps.credentialCleanup && this.deps.leaseStore && typeof this.deps.leaseStore.deleteTenantLeases === "function") {
      await this.deps.leaseStore.deleteTenantLeases(organizationId);
    }

    // 5. Delete memories in MemoryStore
    if (this.deps.memoryStore && typeof this.deps.memoryStore.deleteTenantMemories === "function") {
      await this.deps.memoryStore.deleteTenantMemories(organizationId);
    }

    // 6. Delete agent goals and reporting lines
    await this.deps.organizationStore?.purgeTenantGoals?.(organizationId);

    // 7. Delete budgets
    await this.deps.budgetStore?.purgeTenantBudgets?.(organizationId);

    // 8. Purge all studio tables and the organization profile row itself
    await scoped(() => this.deps.studioStore.transaction(async tx => {
      await tx.purgeOrganizationData(organizationId);
      // Retain the deleting profile if final verification fails.
      await this.assertClean(organizationId, tx);
    }));

    // 9. Filesystem cleanup (executed only after database purge transaction commits and passes verification)
    if (this.deps.workspaceCleanup) {
      await this.deps.workspaceCleanup(organizationId);
    } else if (this.deps.workspaceStorageRoot) {
      if (/[\\/\0]/.test(organizationId) || organizationId === "." || organizationId === "..") throw new Error("Invalid organization workspace segment");
      const root = resolve(this.deps.workspaceStorageRoot);
      const tenantRoot = resolve(root, organizationId);
      if (dirname(tenantRoot) !== root) throw new Error("Invalid organization workspace path");
      await rm(tenantRoot, {recursive: true, force: true});
    }
    });
  }

  async assertClean(organizationId: string, store: StudioStore = this.deps.studioStore): Promise<void> {
    const profile = await store.getOrganizationProfile({ userId: "system", tenantId: organizationId });
    if (profile !== null) {
      throw new Error(`Purge incomplete: organization profile row still exists for ${organizationId}`);
    }
    const memberships = await store.listMemberships(organizationId);
    if (memberships.length > 0) {
      throw new Error(`Purge incomplete: memberships still exist for ${organizationId}`);
    }
  }
}
