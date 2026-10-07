import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, putWorkspaceRepositories } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const body = await request.json() as {
      repositories?: Array<{ projectRepositoryId: string; branch?: string }>;
    };
    if (!Array.isArray(body.repositories)) {
      return NextResponse.json({ error: "repositories array is required" }, { status: 400 });
    }
    return NextResponse.json(await putWorkspaceRepositories(workspaceId, body.repositories, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
