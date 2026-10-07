import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, getOrganizationCurrent } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET() {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getOrganizationCurrent(principal));
  } catch (error) {
    if (error instanceof StudioEntityError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
