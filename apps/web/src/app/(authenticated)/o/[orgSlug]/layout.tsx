import React from "react";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDbPool } from "@/lib/db";
import { AppShell } from "@/components/layout/AppShell";
import { OrgProvider, type OrgInfo } from "@/components/organization/OrgProvider";

async function loadMembershipContext(userId: string, slug: string): Promise<{
  current: OrgInfo;
  organizations: OrgInfo[];
} | null> {
  const pool = getDbPool();
  const currentRes = await pool.query(
    `SELECT o.id, o.slug, o.name, m.role
       FROM studio_organizations o
       INNER JOIN studio_organization_memberships m
         ON m.organization_id = o.id
      INNER JOIN studio_users u ON u.id = m.user_id
      WHERE u.status = 'active' AND lower(o.slug) = lower($1)
        AND m.user_id = $2
        AND m.status = 'active'
        AND o.status = 'active'
      LIMIT 1`,
    [slug, userId],
  );
  if (!currentRes.rows[0]) return null;

  const listRes = await pool.query(
    `SELECT o.id, o.slug, o.name, m.role
       FROM studio_organizations o
       INNER JOIN studio_organization_memberships m
         ON m.organization_id = o.id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND o.status = 'active'
      ORDER BY o.name ASC, o.id ASC`,
    [userId],
  );

  return {
    current: {
      id: String(currentRes.rows[0].id),
      slug: String(currentRes.rows[0].slug),
      name: String(currentRes.rows[0].name),
      role: currentRes.rows[0].role,
    },
    organizations: listRes.rows.map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
    })),
  };
}

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  let ctx: Awaited<ReturnType<typeof loadMembershipContext>> = null;
  try {
    ctx = await loadMembershipContext(userId, orgSlug);
  } catch {
    notFound();
  }
  if (!ctx) notFound();

  // Persist last-used organization for redirects (non-authoritative).
  try {
    const pool = getDbPool();
    await pool.query(`UPDATE studio_users SET tenant_id = $2, updated_at = now() WHERE id = $1`, [
      userId,
      ctx.current.id,
    ]);
  } catch {
    /* non-fatal */
  }

  return (
    <OrgProvider org={ctx.current} organizations={ctx.organizations}>
      <AppShell>{children}</AppShell>
    </OrgProvider>
  );
}
