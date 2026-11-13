import "server-only";
import { getDbPool } from "@/lib/db";

export type ActiveOrganization = { id: string; slug: string };

/**
 * Last-used organization when that membership is still active, otherwise the
 * first active membership. Returns null only when the account has none.
 * Database failures propagate so callers do not treat an outage as "no organization".
 */
export async function findActiveOrganization(userId: string): Promise<ActiveOrganization | null> {
  const pool = getDbPool();
  const last = await pool.query<{ id: string; slug: string }>(
    `SELECT o.id, o.slug
       FROM studio_users u
       INNER JOIN studio_organization_memberships m
         ON m.user_id = u.id AND m.organization_id = u.tenant_id AND m.status = 'active'
       INNER JOIN studio_organizations o
         ON o.id = u.tenant_id AND o.status = 'active'
      WHERE u.id = $1
      LIMIT 1`,
    [userId],
  );
  const preferred = last.rows[0];
  if (preferred?.slug) {
    return { id: String(preferred.id), slug: String(preferred.slug) };
  }

  const first = await pool.query<{ id: string; slug: string }>(
    `SELECT o.id, o.slug
       FROM studio_organization_memberships m
       INNER JOIN studio_organizations o ON o.id = m.organization_id
      WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
      ORDER BY o.name ASC, o.id ASC
      LIMIT 1`,
    [userId],
  );
  const fallback = first.rows[0];
  if (fallback?.slug) {
    return { id: String(fallback.id), slug: String(fallback.slug) };
  }
  return null;
}
