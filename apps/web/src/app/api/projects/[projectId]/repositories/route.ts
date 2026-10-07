import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import {
  StudioEntityError,
  attachProjectRepository,
  listProjectRepositories,
} from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  try {
    return NextResponse.json(await listProjectRepositories(projectId, principal));
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  try {
    const body = await request.json() as { name?: string; source?: string; defaultBranch?: string };
    if (!body.name?.trim() || !body.source?.trim() || !body.defaultBranch?.trim()) {
      return NextResponse.json({ error: "name, source, and defaultBranch are required" }, { status: 400 });
    }
    return NextResponse.json(
      await attachProjectRepository(
        projectId,
        { name: body.name, source: body.source, defaultBranch: body.defaultBranch },
        principal,
      ),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
