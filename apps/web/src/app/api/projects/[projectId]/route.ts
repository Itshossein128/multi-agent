import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, getProject, getProjectDashboard, patchProject, retireProject } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const principal = await getAuthenticatedPrincipal(_request);
  if (!principal) return NextResponse.json({ error: new URL(_request.url).pathname.startsWith("/api/o/") ? "Not found" : "Unauthorized" }, { status: new URL(_request.url).pathname.startsWith("/api/o/") ? 404 : 401 });
  const { projectId } = await context.params;
  const dashboard = new URL(_request.url).searchParams.get("dashboard") === "1";
  try {
    return NextResponse.json(dashboard ? await getProjectDashboard(projectId, principal) : await getProject(projectId, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const principal = await getAuthenticatedPrincipal(request);
  if (!principal) return NextResponse.json({ error: new URL(request.url).pathname.startsWith("/api/o/") ? "Not found" : "Unauthorized" }, { status: new URL(request.url).pathname.startsWith("/api/o/") ? 404 : 401 });
  const { projectId } = await context.params;
  try {
    const body = await request.json() as { name?: string; description?: string; settings?: Record<string, unknown>; action?: string };
    if (body.action === "retire") return NextResponse.json(await retireProject(projectId, principal));
    return NextResponse.json(await patchProject(projectId, body, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
