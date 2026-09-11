"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";

export default function ToolRegistry() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tools = useQuery({ queryKey: ["tool-registry"], queryFn: () => workflowService.listTools(), refetchOnMount: "always" });
  return <main className="min-h-screen space-y-6 bg-zinc-950 p-6 text-zinc-100">
    <Link className="text-indigo-300 underline" href="/org">Back to Graph Editor</Link>
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Tool registry</h1>
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { const tool = await workflowService.createTool(); router.push(`/org/tools/${tool.id}`); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
      }}>Create tool</Button></div>
    <p className="text-zinc-400">Tools exist independently of graph nodes. Reuse any registered tool across multiple workflows and agents.</p>
    {tools.isPending && <p role="status">Loading tools…</p>}
    {(error || tools.error) && <p role="alert" className="text-red-300">{error || tools.error?.message}<Button variant="outline" onClick={() => void tools.refetch()}>Retry</Button></p>}
    {tools.data?.length === 0 && <p>No tools yet. Create one to configure it.</p>}
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tools.data?.map((tool) => <li key={tool.id} className="space-y-2 rounded-xl border border-zinc-800 p-4">
      <Link className="text-lg font-medium text-indigo-300 underline" href={`/org/tools/${tool.id}`}>{tool.name}</Link>
      <p className="text-sm text-zinc-400">{tool.category} · {tool.impact}</p>
      <p className="text-sm">{tool.enabled === false ? "Disabled" : "Enabled"}</p>
      <p className="break-words text-sm text-zinc-300">{tool.description || "No description."}</p>
    </li>)}</ul>
  </main>;
}
