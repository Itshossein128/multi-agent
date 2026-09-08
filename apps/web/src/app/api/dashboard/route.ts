import { NextResponse } from "next/server";
import { runtimeTracker } from "@/lib/runtimeTracker";

export async function GET() {
  // If Langfuse API is active, optionally fetch remote traces
  const langfuseHost = process.env.LANGFUSE_HOST;
  const langfusePub = process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseSec = process.env.LANGFUSE_SECRET_KEY;

  if (langfuseHost && langfusePub && langfuseSec) {
    try {
      const auth = Buffer.from(`${langfusePub}:${langfuseSec}`).toString("base64");
      const res = await fetch(`${langfuseHost}/api/public/traces?limit=10`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.data)) {
          // Ingest any new external traces from Langfuse into the runtime tracker
          for (const trace of data.data) {
            const exists = runtimeTracker.completedTasks.some((t) => t.id === trace.id);
            if (!exists) {
              const tokens = trace.totalTokenCount || 0;
              const cost = trace.calculatedTotalCost || Number((tokens * 0.000002).toFixed(5));
              runtimeTracker.recordExecution({
                name: trace.name || "Agent Graph Node",
                status: trace.status === "ERROR" ? "FAILED" : "COMPLETED",
                agent: trace.name?.includes("dev")
                  ? "Developer Agent"
                  : trace.name?.includes("doc")
                  ? "Doc Generator Agent"
                  : "Orchestrator Agent",
                tokens,
                cost,
                durationMs: trace.latency ? trace.latency * 1000 : undefined,
                error: trace.errorMessage,
              });
            }
          }
        }
      }
    } catch {
      // Langfuse offline or unreachable, fall back gracefully to local runtime tracker
    }
  }

  const dashboardData = runtimeTracker.getDashboardData();
  return NextResponse.json(dashboardData);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, taskId, title, role, priority } = body;

    if (action === "retry" && taskId) {
      runtimeTracker.retryTask(taskId);
      return NextResponse.json({ success: true, message: `Task ${taskId} re-queued` });
    }

    if (action === "cancel" && taskId) {
      runtimeTracker.dequeueTask(taskId);
      return NextResponse.json({ success: true, message: `Task ${taskId} cancelled` });
    }

    if (action === "enqueue" && title && role) {
      const id = runtimeTracker.enqueueTask(title, role, priority || "medium");
      return NextResponse.json({ success: true, id });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
