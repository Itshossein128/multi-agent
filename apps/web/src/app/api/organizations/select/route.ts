import { NextResponse } from "next/server";
import { getSessionUserId } from "@/auth";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { slug?: string };
  const slug = body.slug?.trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

  try {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT o.id, o.slug, o.name
         FROM studio_organizations o
         INNER JOIN studio_organization_memberships m
           ON m.organization_id = o.id
        WHERE lower(o.slug) = $1
          AND m.user_id = $2
          AND m.status = 'active'
          AND o.status = 'active'
        LIMIT 1`,
      [slug, userId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await pool.query(`UPDATE studio_users SET tenant_id = $2, updated_at = now() WHERE id = $1`, [
      userId,
      result.rows[0].id,
    ]);

    return NextResponse.json({
      id: result.rows[0].id,
      slug: result.rows[0].slug,
      name: result.rows[0].name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
