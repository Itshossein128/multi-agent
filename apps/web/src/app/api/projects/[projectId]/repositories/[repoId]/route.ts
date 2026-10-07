import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, removeProjectRepository } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string; repoId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId, repoId } = await context.params;
  try {
    let confirmDiscardChanges = false;
    try {
      const body = await request.json() as { confirmDiscardChanges?: boolean };
      confirmDiscardChanges = Boolean(body.confirmDiscardChanges);
    } catch {
      // empty body is fine
    }
    await removeProjectRepository(projectId, repoId, principal, confirmDiscardChanges);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
