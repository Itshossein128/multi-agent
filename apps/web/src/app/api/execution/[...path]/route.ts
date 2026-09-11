import { proxyExecution } from "@/lib/executionBff";

async function route(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  try {
    const { path } = await context.params;
    return await proxyExecution(request, `/${path.join("/")}`);
  } catch (error) {
    console.error("[execution proxy] Unhandled error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal proxy error" },
      { status: 500 }
    );
  }
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
