"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

interface DashboardPayload {
  workspace: { id: string; name: string; description: string; status: string };
  tasks: Array<{ id: string; title: string; status: string; priority: string; workspaceId: string; projectIds: string[] }>;
  relatedProjects: Array<{ id: string; name: string }>;
}

export default function WorkspaceDashboardPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}?dashboard=1`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load workspace dashboard");
      setData(body);
      setName(body.workspace.name);
      setDescription(body.workspace.description ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace dashboard");
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    if (!window.confirm("Retire this workspace?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retire" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Retire failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retire failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-3">
        <p role="alert" className="text-sm text-red-300">{error}</p>
        <Button onClick={() => void load()}>Retry</Button>
        <Link href="/workspaces" className="text-sm text-indigo-300 hover:underline block">← Workspaces</Link>
      </div>
    );
  }

  if (!data) return <div className="container mx-auto px-4 py-8 text-sm text-zinc-400">Loading workspace…</div>;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/workspaces" className="text-xs text-indigo-300 hover:underline">← Workspaces</Link>
          <h1 className="text-xl font-semibold text-white mt-1">{data.workspace.name}</h1>
          <p className="text-xs text-zinc-500 break-all">{data.workspace.id} · {data.workspace.status}</p>
        </div>
        {data.workspace.status === "active" && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void retire()}>Retire</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Related tasks</h2>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks in this workspace yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.tasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                <Link href="/tasks" className="text-indigo-300 hover:underline">{task.title}</Link>
                <span className="text-zinc-500 text-xs ml-2">{task.status} · {task.priority}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Related projects</h2>
        {data.relatedProjects.length === 0 ? (
          <p className="text-sm text-zinc-500">No related projects yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.relatedProjects.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${encodeURIComponent(project.id)}`} className="text-sm text-indigo-300 hover:underline">{project.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Configuration</h2>
        <form onSubmit={saveConfig} className="space-y-3 max-w-lg">
          <label className="block space-y-1 text-xs text-zinc-400">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
          </label>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>Save</Button>
        </form>
      </section>
    </div>
  );
}
