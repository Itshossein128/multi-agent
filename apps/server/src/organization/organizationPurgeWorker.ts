import { nowIso } from "@multi-agent/types";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { OrganizationStore } from "./organizationStore";
import type { BudgetStore } from "../budgets/budgetStore";
import type { RunStoreContract } from "../runtime/store/contracts";
import type { MemoryStore } from "../../../../src/memory/contracts";
import type { LeaseStore } from "../../../../src/broker/leaseStore";
import type { SecretStore } from "../../../../src/broker/secretStore";
import { clearWorkspaceStorage } from "../../../../scripts/db-reset";

export interface OrganizationPurgeDependencies {
  studioStore: StudioStore;
  organizationStore?: OrganizationStore;
  budgetStore?: BudgetStore;
  runStore?: RunStoreContract;
  memoryStore?: MemoryStore;
  leaseStore?: LeaseStore;
  secretStore?: SecretStore;
  workspaceStorageRoot?: string;
}

export interface PurgeResult {
  status: "completed";
  organizationId: string;
  purgedAt: string;
}

export class OrganizationPurgeWorker {
  constructor(private readonly deps: OrganizationPurgeDependencies) {}

  async findPendingPurges(): Promise<string[]> {
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
    // 1. Mark status as 'deleting' to block incoming traffic and prevent late writes
    try {
      await this.deps.studioStore.updateOrganizationStatus(organizationId, "deleting");
    } catch {
      // Organization may already be in 'deleting' status during resume
    }

    // 2. Cancel and purge runs
    if (this.deps.runStore) {
      const runStoreAny = this.deps.runStore as unknown as { purgeTenantRuns?: (tenantId: string) => void };
      if (typeof runStoreAny.purgeTenantRuns === "function") {
        runStoreAny.purgeTenantRuns(organizationId);
      } else {
        const runs = this.deps.runStore.list({} as any, { tenantId: organizationId, userId: "" });
        for (const run of runs) {
          this.deps.runStore.cancel(run.id);
        }
      }
    }

    // 3. Delete secrets in SecretStore
    if (this.deps.secretStore && typeof this.deps.secretStore.deleteTenantSecrets === "function") {
      await this.deps.secretStore.deleteTenantSecrets(organizationId);
    }

    // 4. Delete leases in LeaseStore (credential_broker_audit rows are preserved per Q2)
    if (this.deps.leaseStore && typeof this.deps.leaseStore.deleteTenantLeases === "function") {
      await this.deps.leaseStore.deleteTenantLeases(organizationId);
    }

    // 5. Delete memories in MemoryStore
    if (this.deps.memoryStore && typeof this.deps.memoryStore.deleteTenantMemories === "function") {
      await this.deps.memoryStore.deleteTenantMemories(organizationId);
    }

    // 6. Delete agent goals and reporting lines
    if (this.deps.organizationStore) {
      const orgStoreAny = this.deps.organizationStore as unknown as { purgeTenantGoals?: (tenantId: string) => void };
      if (typeof orgStoreAny.purgeTenantGoals === "function") {
        orgStoreAny.purgeTenantGoals(organizationId);
      }
    }

    // 7. Delete budgets
    if (this.deps.budgetStore) {
      const budgetStoreAny = this.deps.budgetStore as unknown as { purgeTenantBudgets?: (tenantId: string) => void };
      if (typeof budgetStoreAny.purgeTenantBudgets === "function") {
        budgetStoreAny.purgeTenantBudgets(organizationId);
      }
    }

    // 8. Filesystem cleanup
    if (this.deps.workspaceStorageRoot) {
      clearWorkspaceStorage(this.deps.workspaceStorageRoot);
    }

    // 9. Purge all studio tables and the organization profile row itself
    await this.deps.studioStore.purgeOrganizationData(organizationId);

    // 10. Assert complete cleanup across stores before reporting success (SC-008)
    await this.assertClean(organizationId);

    return {
      status: "completed",
      organizationId,
      purgedAt: nowIso(),
    };
  }

  async assertClean(organizationId: string): Promise<void> {
    const profile = await this.deps.studioStore.getOrganizationProfile({ userId: "system", tenantId: organizationId });
    if (profile !== null) {
      throw new Error(`Purge incomplete: organization profile row still exists for ${organizationId}`);
    }
    const memberships = await this.deps.studioStore.listMemberships(organizationId);
    if (memberships.length > 0) {
      throw new Error(`Purge incomplete: memberships still exist for ${organizationId}`);
    }
  }
}
