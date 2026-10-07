import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import {
  StudioEntityError,
  createProjectWorkspace,
  listProjectWorkspaces,
} from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  const status = new URL(request.url).searchParams.get("status") ?? "active";
  try {
    return NextResponse.json(await listProjectWorkspaces(projectId, principal, status));
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
    const body = await request.json() as {
      name?: string;
      description?: string;
      settingsOverrides?: Record<string, unknown>;
      repositories?: Array<{ projectRepositoryId: string; branch?: string }>;
    };
    return NextResponse.json(await createProjectWorkspace(projectId, body, principal), { status: 201 });
  } catch (error) {
    if (error instanceof StudioEntityError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
