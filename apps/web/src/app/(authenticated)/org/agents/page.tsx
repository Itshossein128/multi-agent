"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";

export default function AgentRegistry() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const agents = useQuery({ queryKey: ["agent-registry"], queryFn: () => workflowService.listAgents(), refetchOnMount: "always" });
  return <main className="min-h-screen space-y-6 bg-zinc-950 p-6 text-zinc-100">
    <Link className="text-indigo-300 underline" href="/org">Back to Graph Editor</Link>
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Agent registry</h1>
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { const agent = await workflowService.createAgent(); router.push(`/org/agents/${agent.id}`); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
      }}>Create agent</Button></div>
    <p className="text-zinc-400">Agents exist independently of graph nodes. Reuse any registered agent in multiple workflows.</p>
    {agents.isPending && <p role="status">Loading agents…</p>}
    {(error || agents.error) && <p role="alert" className="text-red-300">{error || agents.error?.message}<Button variant="outline" onClick={() => void agents.refetch()}>Retry</Button></p>}
    {agents.data?.length === 0 && <p>No agents yet. Create one to configure it.</p>}
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{agents.data?.map((agent) => <li key={agent.id} className="space-y-2 rounded-xl border border-zinc-800 p-4">
      <Link className="text-lg font-medium text-indigo-300 underline" href={`/org/agents/${agent.id}`}>{agent.name}</Link>
      <p className="text-sm text-zinc-400">{agent.backend.type} / {agent.backend.provider} / {agent.backend.model || "Runtime default"}</p>
      <p className="text-sm">{agent.enabled === false ? "Disabled" : "Enabled"}</p>
      <p className="break-words text-sm text-zinc-300">{agent.description || "No description."}</p>
    </li>)}</ul>
  </main>;
}
