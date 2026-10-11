import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDbPool } from "@/lib/db";
import { orgPath } from "@/lib/orgRoute";

const ONBOARDING = "/onboarding/organization";

export default async function AuthenticatedHomePage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  try {
    const pool = getDbPool();
    const last = await pool.query(
      `SELECT o.slug
         FROM studio_users u
         INNER JOIN studio_organization_memberships m
           ON m.user_id = u.id AND m.organization_id = u.tenant_id AND m.status = 'active'
         INNER JOIN studio_organizations o
           ON o.id = u.tenant_id AND o.status = 'active'
        WHERE u.id = $1
        LIMIT 1`,
      [userId],
    );
    if (last.rows[0]?.slug) {
      redirect(orgPath(String(last.rows[0].slug), "/"));
    }

    const first = await pool.query(
      `SELECT o.slug
         FROM studio_organization_memberships m
         INNER JOIN studio_organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
        ORDER BY o.name ASC, o.id ASC
        LIMIT 1`,
      [userId],
    );
    if (first.rows[0]?.slug) {
      redirect(orgPath(String(first.rows[0].slug), "/"));
    }
  } catch {
    redirect(ONBOARDING);
  }

  redirect(ONBOARDING);
}
