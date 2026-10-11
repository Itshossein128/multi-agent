#!/usr/bin/env node
/**
 * Non-production seed: AUTH_DEV_USER_ID + AUTH_DEV_TENANT_ID as real user + org + owner membership.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { nowIso } from "@multi-agent/types";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:seed:dev refuses to run when NODE_ENV=production");
  }
  const url = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  if (!url) throw new Error("MEMORY_DATABASE_URL (or STUDIO_DATABASE_URL) is required");

  const userId = process.env.AUTH_DEV_USER_ID ?? "dev-user";
  const orgId = process.env.AUTH_DEV_TENANT_ID ?? "dev-org";
  const email = process.env.AUTH_DEV_EMAIL ?? "dev@localhost";
  const password = process.env.AUTH_DEV_PASSWORD ?? "dev-password";
  const slug = (process.env.AUTH_DEV_ORG_SLUG ?? "dev").toLowerCase();

  const pool = new Pool({ connectionString: url });
  try {
    await runStudioMigrations(pool);
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status)
       VALUES ($1, $2, $3, $4, NULL, 'active')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, status = 'active'`,
      [userId, email.toLowerCase(), passwordHash, "Dev User"],
    );

    const store = new PostgresStudioStore(pool);
    const existing = await store.getOrganizationProfile({ userId, tenantId: orgId });
    if (!existing) {
      const stamp = nowIso();
      await store.createOrganizationProfile(
        {
          id: orgId,
          name: process.env.AUTH_DEV_ORG_NAME ?? "Dev Organization",
          description: "Seeded development organization",
          config: {},
          ownerId: userId,
          status: "active",
          slug,
          createdBy: userId,
          createdAt: stamp,
          updatedAt: stamp,
        },
        { userId, tenantId: orgId },
      );
    } else {
      await store.setUserLastOrganization(userId, orgId);
    }

    console.log(
      JSON.stringify({
        event: "db.seed.dev",
        userId,
        organizationId: orgId,
        slug,
        email,
        note: "Env AUTH_DEV_TENANT_ID is no longer trusted without this membership row",
        nonce: randomUUID(),
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
