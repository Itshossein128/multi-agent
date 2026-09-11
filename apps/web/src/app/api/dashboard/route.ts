import { proxyExecution } from "@/lib/executionBff";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyExecution(request, "/dashboard");
}

export async function POST(request: Request) {
  return proxyExecution(request, "/dashboard");
}
