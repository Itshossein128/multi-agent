import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, createWorkspace, listWorkspaces, retireWorkspace } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = new URL(request.url).searchParams.get("status") ?? "active";
  try {
    return NextResponse.json(await listWorkspaces(principal, status));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { action?: string; id?: string; name?: string; description?: string };
    if (body.action === "retire") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      return NextResponse.json(await retireWorkspace(body.id, principal));
    }
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    return NextResponse.json(await createWorkspace({ name: body.name, description: body.description }, principal), { status: 201 });
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
