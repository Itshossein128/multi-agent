"use client";

import { useOrgPath } from "@/components/organization/OrgProvider";

import { scopedApiPath } from "@/lib/orgRoute";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Plus, RefreshCw } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";

interface WorkspaceRow {
  id: string;
  name: string;
  description: string;
  status: string;
  projectId: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
}

export default function WorkspacesPage() {
  const orgUrl = useOrgPath();
  const [items, setItems] = useState<WorkspaceRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wsRes, projRes] = await Promise.all([fetch(scopedApiPath("/api/workspaces")), fetch(scopedApiPath("/api/projects"))]);
      const [wsBody, projBody] = await Promise.all([wsRes.json(), projRes.json()]);
      if (!wsRes.ok) throw new Error(wsBody.error ?? "Failed to load workspaces");
      if (!projRes.ok) throw new Error(projBody.error ?? "Failed to load projects");
      setItems(wsBody);
      setProjects(projBody);
      setProjectId((current) => current || (projBody as ProjectRow[])[0]?.id || "");
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, WorkspaceRow[]>();
    for (const item of items) {
      const key = item.projectId || "unknown";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const an = projectNameById.get(a) ?? a;
      const bn = projectNameById.get(b) ?? b;
      return an.localeCompare(bn);
    });
  }, [items, projectNameById]);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}/workspaces`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(name.trim() ? { name: name.trim() } : {}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Create failed");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string) {
    if (!window.confirm("Retire this workspace? It will leave the active list and cannot receive new tasks.")) return;
    setBusy(true);
    try {
      const res = await fetch(scopedApiPath("/api/workspaces"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retire", id }),
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

  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(scopedApiPath(`/api/workspaces/${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rename failed");
      setRenamingId(null);
      setRenameValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <div className="flex flex-col items-start justify-between gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <Boxes className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">Project workspaces</h1>
              {loaded ? (
                <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-400">
                  {items.length}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-zinc-400">
              Workspaces belong to a project. Browse by project or open a dashboard for tasks and repo branches.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || busy}
          onClick={() => void load()}
          className="gap-1.5 text-xs cursor-pointer"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 shrink-0 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      <form
        onSubmit={createWorkspace}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
      >
        <label className="min-w-[12rem] space-y-1.5 text-xs font-medium text-zinc-400">
          <span>Project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            required
          >
            <option value="">Select project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex-1 min-w-[14rem] space-y-1.5 text-xs font-medium text-zinc-400">
          <span>Workspace name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            placeholder="e.g. Lab environment"
          />
        </label>
        <Button
          type="submit"
          disabled={busy || !projectId}
          size="sm"
          className="h-9 gap-1.5 bg-indigo-600 px-4 text-xs text-white hover:bg-indigo-500 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Create
        </Button>
      </form>

      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Retry</Button>
        </div>
      )}
      {loading && <p className="text-sm text-zinc-400">Loading workspaces…</p>}

      {!loading && loaded && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center space-y-2">
          <p className="text-sm text-zinc-300">No active workspaces yet.</p>
          <p className="text-xs text-zinc-500">Create one above under a project, or start from a project dashboard.</p>
          <Link href={orgUrl("/projects")} className="inline-block text-xs text-indigo-300 hover:underline">Go to Projects →</Link>
        </div>
      )}

      {loaded && grouped.map(([groupProjectId, workspaces]) => (
        <section key={groupProjectId} className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">
            {groupProjectId === "unknown" ? (
              "Unknown project"
            ) : (
              <Link href={orgUrl(`/projects/${encodeURIComponent(groupProjectId)}`)} className="text-indigo-300 hover:underline">
                {projectNameById.get(groupProjectId) ?? groupProjectId}
              </Link>
            )}
          </h2>
          <ul className="space-y-2">
            {workspaces.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  {renamingId === item.id ? (
                    <form
                      className="flex flex-wrap gap-2 items-center"
                      onSubmit={(e) => { e.preventDefault(); void saveRename(item.id); }}
                    >
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 min-w-[10rem] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
                        autoFocus
                      />
                      <Button type="submit" size="sm" disabled={busy || !renameValue.trim()}>Save</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingId(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <Link href={orgUrl(`/workspaces/${encodeURIComponent(item.id)}`)} className="font-medium text-indigo-300 hover:underline">
                        {item.name}
                      </Link>
                      <p className="text-xs text-zinc-500 break-all">{item.id}</p>
                      {item.description ? <p className="text-xs text-zinc-400 mt-1">{item.description}</p> : null}
                    </>
                  )}
                </div>
                {renamingId !== item.id && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => { setRenamingId(item.id); setRenameValue(item.name); }}
                    >
                      Rename
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void retire(item.id)}>Retire</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageContainer>
  );
}
