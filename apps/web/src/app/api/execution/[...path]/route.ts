import { proxyExecution } from "@/lib/executionBff";
const route = (request: Request, context: { params: Promise<{ path: string[] }> }) => context.params.then(({ path }) => proxyExecution(request, `/${path.join("/")}`));
export const GET = route; export const POST = route; export const PUT = route; export const PATCH = route; export const DELETE = route;
