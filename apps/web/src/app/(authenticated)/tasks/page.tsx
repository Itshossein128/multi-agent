import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDbPool } from "@/lib/db";
import { orgPath } from "@/lib/orgRoute";

export default async function TopLevelTasksRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  let slug = "default";
  try {
    const pool = getDbPool();
    const res = await pool.query(
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
    if (res.rows[0]?.slug) {
      slug = String(res.rows[0].slug);
    }
  } catch {
    // fallback to default
  }

  const resolvedParams = await searchParams;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(resolvedParams)) {
    if (typeof v === "string") {
      search.set(k, v);
    } else if (Array.isArray(v)) {
      v.forEach((item) => search.append(k, item));
    }
  }
  const queryString = search.toString();
  const dest = orgPath(slug, `/tasks${queryString ? `?${queryString}` : ""}`);
  redirect(dest);
}
