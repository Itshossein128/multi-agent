import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import { StudioEntityError, createOrganization } from "@/lib/projectsWorkspaces";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      config?: Record<string, unknown>;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (body.name.trim().length > 120) {
      return NextResponse.json({ error: "name must be at most 120 characters" }, { status: 400 });
    }
    return NextResponse.json(
      await createOrganization(
        {
          name: body.name.trim(),
          description: body.description,
          config: body.config,
        },
        principal,
      ),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof StudioEntityError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
