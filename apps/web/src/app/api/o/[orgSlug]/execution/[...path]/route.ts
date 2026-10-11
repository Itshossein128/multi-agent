import { proxyExecutionWith } from "@/lib/executionBff";
import { getSessionUserId } from "@/auth";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveOrgPrincipal(orgSlug: string) {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT o.id
       FROM studio_organizations o
       INNER JOIN studio_organization_memberships m ON m.organization_id = o.id
      WHERE lower(o.slug) = lower($1)
        AND m.user_id = $2
        AND m.status = 'active'
        AND o.status = 'active'
      LIMIT 1`,
    [orgSlug, userId],
  );
  if (!result.rows[0]) return null;
  const organizationId = String(result.rows[0].id);
  return { userId, tenantId: organizationId, organizationId };
}

async function handle(
  request: Request,
  context: { params: Promise<{ orgSlug: string; path: string[] }> | { orgSlug: string; path: string[] } },
) {
  const { orgSlug, path } = await Promise.resolve(context.params);
  const principal = await resolveOrgPrincipal(orgSlug);
  if (!principal) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const joined = Array.isArray(path) ? path.join("/") : String(path ?? "");
  return proxyExecutionWith(request, joined, {
    principal: async () => principal,
    fetchImpl: fetch,
    secret: process.env.INTERNAL_PRINCIPAL_SECRET,
    base: process.env.EXECUTION_SERVER_URL ?? "http://localhost:4000",
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
