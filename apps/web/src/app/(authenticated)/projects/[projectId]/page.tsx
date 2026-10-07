"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

interface WorkspaceRow {
  id: string;
  name: string;
  overriddenKeys?: string[];
  settingsOverrides?: Record<string, unknown>;
  effectiveSettings?: Record<string, unknown>;
}

interface RepoRow {
  id: string;
  name: string;
  source: string;
  defaultBranch: string;
  status: string;
}

interface DashboardPayload {
  project: {
    id: string;
    name: string;
    description: string;
    status: string;
    settings?: Record<string, unknown>;
    usesDefaultWorkspace?: boolean;
  };
  usesDefaultWorkspace?: boolean;
  workspaces?: WorkspaceRow[];
  repositories?: RepoRow[];
  tasks: Array<{ id: string; title: string; status: string; priority: string; workspaceId: string | null; projectId: string }>;
  relatedWorkspaces: WorkspaceRow[];
}

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100";

export default function ProjectDashboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  /** Per-repo branch overrides for workspace create (T051). */
  const [workspaceRepoBranches, setWorkspaceRepoBranches] = useState<Record<string, string>>({});
  const [selectedWorkspaceRepos, setSelectedWorkspaceRepos] = useState<Record<string, boolean>>({});
  const [repoName, setRepoName] = useState("");
  const [repoSource, setRepoSource] = useState("");
  const [repoBranch, setRepoBranch] = useState("main");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}?dashboard=1`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load project dashboard");
      setData(body);
      setName(body.project.name);
      setDescription(body.project.description ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project dashboard");
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
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
    if (!window.confirm("Retire this project?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
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

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const repos = data?.repositories ?? [];
      const selected = repos.filter((repo) => selectedWorkspaceRepos[repo.id] !== false);
      const payload: {
        name?: string;
        repositories?: Array<{ projectRepositoryId: string; branch: string }>;
      } = workspaceName.trim() ? { name: workspaceName.trim() } : {};
      if (repos.length > 0) {
        const chosen = (selected.length > 0 ? selected : repos).map((repo) => ({
          projectRepositoryId: repo.id,
          branch: (workspaceRepoBranches[repo.id] ?? repo.defaultBranch).trim() || repo.defaultBranch,
        }));
        payload.repositories = chosen;
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Create workspace failed");
      setWorkspaceName("");
      setWorkspaceRepoBranches({});
      setSelectedWorkspaceRepos({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create workspace failed");
    } finally {
      setBusy(false);
    }
  }

  async function attachRepo(e: React.FormEvent) {
    e.preventDefault();
    if (!repoName.trim() || !repoSource.trim() || !repoBranch.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repositories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repoName.trim(),
          source: repoSource.trim(),
          defaultBranch: repoBranch.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Attach repository failed");
      setRepoName("");
      setRepoSource("");
      setRepoBranch("main");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attach repository failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeRepo(repoId: string) {
    if (!window.confirm("Remove this repository from the project?")) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = async (confirmDiscardChanges: boolean) =>
        fetch(
          `/api/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(confirmDiscardChanges ? { confirmDiscardChanges: true } : {}),
          },
        );

      let res = await attempt(false);
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        const message =
          (body as { error?: string }).error
          ?? "A workspace has uncommitted changes for this repository.";
        const discard = window.confirm(
          `${message}\n\nDiscard those changes and remove the repository?`,
        );
        if (!discard) {
          setError("Repository removal cancelled — uncommitted changes were kept.");
          return;
        }
        res = await attempt(true);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Remove repository failed");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove repository failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-3">
        <p role="alert" className="text-sm text-red-300">{error}</p>
        <Button onClick={() => void load()}>Retry</Button>
        <Link href="/projects" className="text-sm text-indigo-300 hover:underline block">← Projects</Link>
      </div>
    );
  }

  if (!data) return <div className="container mx-auto px-4 py-8 text-sm text-zinc-400">Loading project…</div>;

  const usesDefault = Boolean(data.usesDefaultWorkspace ?? data.project.usesDefaultWorkspace);
  const workspaces = data.workspaces?.length ? data.workspaces : data.relatedWorkspaces;
  const repositories = data.repositories ?? [];
  const projectSettings = data.project.settings ?? {};

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/projects" className="text-xs text-indigo-300 hover:underline">← Projects</Link>
          <h1 className="text-xl font-semibold text-white mt-1">{data.project.name}</h1>
          <p className="text-xs text-zinc-500 break-all">{data.project.id} · {data.project.status}</p>
        </div>
        {data.project.status === "active" && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void retire()}>Retire</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Workspaces</h2>
        {usesDefault ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
            Using default workspace — tasks attach at the project level until you create an explicit workspace.
          </p>
        ) : null}
        {workspaces.length === 0 && !usesDefault ? (
          <p className="text-sm text-zinc-500">No workspaces yet.</p>
        ) : (
          <ul className="space-y-1">
            {workspaces.map((ws) => (
              <li key={ws.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                <Link href={`/workspaces/${encodeURIComponent(ws.id)}`} className="text-indigo-300 hover:underline">
                  {ws.name}
                </Link>
                {(ws.overriddenKeys?.length ?? 0) > 0 && (
                  <span className="ml-2 text-[11px] text-amber-300/90">
                    overrides: {ws.overriddenKeys!.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={createWorkspace} className="space-y-3 pt-1">
          <label className="block min-w-[12rem] space-y-1 text-xs text-zinc-400">
            New workspace (name optional)
            <input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Staging"
            />
          </label>
          {repositories.length > 0 && (
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Branches at create
              </p>
              <ul className="space-y-2">
                {repositories.map((repo) => {
                  const checked = selectedWorkspaceRepos[repo.id] !== false;
                  return (
                    <li key={repo.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <label className="flex items-center gap-2 text-zinc-200 cursor-pointer min-w-[10rem]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedWorkspaceRepos((prev) => ({
                              ...prev,
                              [repo.id]: e.target.checked,
                            }))
                          }
                          className="h-3.5 w-3.5 accent-indigo-500"
                        />
                        <span className="truncate">{repo.name}</span>
                      </label>
                      {checked && (
                        <input
                          value={workspaceRepoBranches[repo.id] ?? repo.defaultBranch}
                          onChange={(e) =>
                            setWorkspaceRepoBranches((prev) => ({
                              ...prev,
                              [repo.id]: e.target.value,
                            }))
                          }
                          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 min-w-[8rem]"
                          placeholder={repo.defaultBranch}
                          aria-label={`Branch for ${repo.name}`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <Button type="submit" size="sm" disabled={busy}>Create workspace</Button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Repositories</h2>
        {repositories.length === 0 ? (
          <p className="text-sm text-zinc-500">No repositories attached.</p>
        ) : (
          <ul className="space-y-1">
            {repositories.map((repo) => (
              <li key={repo.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-zinc-100 truncate">{repo.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{repo.source} · {repo.defaultBranch} · {repo.status}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void removeRepo(repo.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={attachRepo} className="grid gap-2 sm:grid-cols-3 pt-1">
          <label className="space-y-1 text-xs text-zinc-400">
            Name
            <input value={repoName} onChange={(e) => setRepoName(e.target.value)} className={inputClass} required />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            Source
            <input value={repoSource} onChange={(e) => setRepoSource(e.target.value)} className={inputClass} placeholder="https://…" required />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            Default branch
            <input value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} className={inputClass} required />
          </label>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" disabled={busy || !repoName.trim() || !repoSource.trim()}>Attach repository</Button>
          </div>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Settings (inherited by workspaces)</h2>
        {Object.keys(projectSettings).length === 0 ? (
          <p className="text-sm text-zinc-500">No project settings yet. Workspace overrides appear on each workspace.</p>
        ) : (
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-300">
            {JSON.stringify(projectSettings, null, 2)}
          </pre>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Related tasks</h2>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks linked to this project yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.tasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                <Link href={`/tasks?taskId=${encodeURIComponent(task.id)}`} className="text-indigo-300 hover:underline">{task.title}</Link>
                <span className="text-zinc-500 text-xs ml-2">{task.status} · {task.priority}</span>
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
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
          </label>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>Save</Button>
        </form>
      </section>
    </div>
  );
}
