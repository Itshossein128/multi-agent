import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal, getSessionUserId } from "@/auth";
import { StudioEntityError, getOrganizationCurrent, patchOrganizationCurrent } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  try {
    return NextResponse.json(await getOrganizationCurrent(principal));
  } catch (error) {
    if (error instanceof StudioEntityError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await patchOrganizationCurrent(body, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
