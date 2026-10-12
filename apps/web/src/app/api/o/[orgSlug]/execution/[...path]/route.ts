import { proxyExecutionWith } from "@/lib/executionBff";
import { getAuthenticatedPrincipal } from "@/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(
  request: Request,
  context: { params: Promise<{ orgSlug: string; path: string[] }> },
) {
  const { path } = await Promise.resolve(context.params);
  const principal = await getAuthenticatedPrincipal(request);
  if (!principal) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const joined = Array.isArray(path) ? path.join("/") : String(path ?? "");
  return proxyExecutionWith(request, joined, {
    principal: async () => principal,
    fetchImpl: fetch,
    secret: process.env.INTERNAL_PRINCIPAL_SECRET,
    base: process.env.EXECUTION_SERVER_URL ?? "http://localhost:4000",
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
