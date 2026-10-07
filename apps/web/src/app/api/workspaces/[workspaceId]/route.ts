import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, getWorkspace, getWorkspaceDashboard, patchWorkspace, retireWorkspace } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  const dashboard = new URL(_request.url).searchParams.get("dashboard") === "1";
  try {
    return NextResponse.json(dashboard ? await getWorkspaceDashboard(workspaceId, principal) : await getWorkspace(workspaceId, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const body = await request.json() as {
      name?: string;
      description?: string;
      settings?: Record<string, unknown>;
      settingsOverrides?: Record<string, unknown>;
      clearOverrideKeys?: string[];
      action?: string;
    };
    if (body.action === "retire") return NextResponse.json(await retireWorkspace(workspaceId, principal));
    return NextResponse.json(await patchWorkspace(workspaceId, body, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
