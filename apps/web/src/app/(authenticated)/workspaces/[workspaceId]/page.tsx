"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

interface RepoMembership {
  workspaceId: string;
  projectRepositoryId: string;
  branch: string;
  availability?: "ready" | "unavailable" | "branch_missing";
  hasUncommittedChanges?: boolean;
  changedFiles?: string[];
}

interface ProjectRepo {
  id: string;
  name: string;
  source: string;
  defaultBranch: string;
  status: string;
}

interface DashboardPayload {
  workspace: {
    id: string;
    name: string;
    description: string;
    status: string;
    projectId: string;
    settingsOverrides?: Record<string, unknown>;
    effectiveSettings?: Record<string, unknown>;
    overriddenKeys?: string[];
  };
  project?: { id: string; name: string; settings?: Record<string, unknown> };
  repositories?: RepoMembership[];
  tasks: Array<{ id: string; title: string; status: string; priority: string; workspaceId: string | null; projectId: string }>;
  relatedProjects: Array<{ id: string; name: string }>;
}

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100";

export default function WorkspaceDashboardPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [projectRepos, setProjectRepos] = useState<ProjectRepo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [overrideJson, setOverrideJson] = useState("{}");
  const [memberships, setMemberships] = useState<RepoMembership[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}?dashboard=1`);
      const body = (await res.json()) as DashboardPayload;
      if (!res.ok) throw new Error((body as unknown as { error?: string }).error ?? "Failed to load workspace dashboard");
      setData(body);
      setName(body.workspace.name);
      setDescription(body.workspace.description ?? "");
      setOverrideJson(JSON.stringify(body.workspace.settingsOverrides ?? {}, null, 2));
      setMemberships(body.repositories ?? []);

      const projectId = body.workspace.projectId ?? body.project?.id;
      if (projectId) {
        const repoRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repositories`);
        const repoBody = await repoRes.json();
        if (repoRes.ok) setProjectRepos(repoBody as ProjectRepo[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace dashboard");
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const repoNameById = useMemo(
    () => new Map(projectRepos.map((r) => [r.id, r.name])),
    [projectRepos],
  );

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let settingsOverrides: Record<string, unknown> | undefined;
      try {
        settingsOverrides = JSON.parse(overrideJson) as Record<string, unknown>;
      } catch {
        throw new Error("Settings overrides must be valid JSON");
      }
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, settingsOverrides }),
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

  async function clearOverrides() {
    if (!data?.workspace.overriddenKeys?.length) return;
    if (!window.confirm("Clear all workspace setting overrides?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearOverrideKeys: data.workspace.overriddenKeys }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Clear overrides failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear overrides failed");
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

  function toggleRepo(repoId: string) {
    setMemberships((prev) => {
      const existing = prev.find((m) => m.projectRepositoryId === repoId);
      if (existing) return prev.filter((m) => m.projectRepositoryId !== repoId);
      const projectRepo = projectRepos.find((r) => r.id === repoId);
      return [
        ...prev,
        {
          workspaceId,
          projectRepositoryId: repoId,
          branch: projectRepo?.defaultBranch ?? "main",
        },
      ];
    });
  }

  function setBranch(repoId: string, branch: string) {
    setMemberships((prev) =>
      prev.map((m) => (m.projectRepositoryId === repoId ? { ...m, branch } : m)),
    );
  }

  async function saveMemberships() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/repositories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositories: memberships.map((m) => ({
            projectRepositoryId: m.projectRepositoryId,
            branch: m.branch,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save repositories failed");
      setMemberships(body as RepoMembership[]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save repositories failed");
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

  const projectId = data.workspace.projectId ?? data.project?.id;
  const projectName = data.project?.name ?? data.relatedProjects[0]?.name;
  const overriddenKeys = data.workspace.overriddenKeys ?? Object.keys(data.workspace.settingsOverrides ?? {});

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/workspaces" className="text-xs text-indigo-300 hover:underline">← Workspaces</Link>
          <h1 className="text-xl font-semibold text-white mt-1">{data.workspace.name}</h1>
          <p className="text-xs text-zinc-500 break-all">{data.workspace.id} · {data.workspace.status}</p>
          {projectId && (
            <p className="text-xs text-zinc-400 mt-1">
              Project:{" "}
              <Link href={`/projects/${encodeURIComponent(projectId)}`} className="text-indigo-300 hover:underline">
                {projectName ?? projectId}
              </Link>
            </p>
          )}
        </div>
        {data.workspace.status === "active" && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void retire()}>Retire</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">Settings overrides</h2>
          {overriddenKeys.length > 0 && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void clearOverrides()}>
              Clear overrides
            </Button>
          )}
        </div>
        {overriddenKeys.length > 0 ? (
          <p className="text-[11px] text-amber-300/90">Overridden keys: {overriddenKeys.join(", ")}</p>
        ) : (
          <p className="text-sm text-zinc-500">No overrides — inheriting project settings.</p>
        )}
        {data.workspace.effectiveSettings && (
          <details className="text-xs text-zinc-400">
            <summary className="cursor-pointer text-zinc-300">Effective settings</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-300">
              {JSON.stringify(data.workspace.effectiveSettings, null, 2)}
            </pre>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Repository membership</h2>
        {projectRepos.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No project repositories yet.{" "}
            {projectId && (
              <Link href={`/projects/${encodeURIComponent(projectId)}`} className="text-indigo-300 hover:underline">
                Attach on the project
              </Link>
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {projectRepos.map((repo) => {
              const membership = memberships.find((m) => m.projectRepositoryId === repo.id);
              const checked = Boolean(membership);
              return (
                <li key={repo.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRepo(repo.id)}
                      className="h-3.5 w-3.5 accent-indigo-500"
                    />
                    <span className="truncate">{repo.name}</span>
                    <span className="text-[11px] text-zinc-500 truncate">{repo.source}</span>
                  </label>
                  {membership && (
                    <div className="flex flex-wrap items-center gap-2 pl-6">
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Branch
                        <input
                          value={membership.branch}
                          onChange={(e) => setBranch(repo.id, e.target.value)}
                          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        />
                      </label>
                      {membership.availability && membership.availability !== "ready" && (
                        <span className="rounded border border-amber-800/80 bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                          {membership.availability.replace("_", " ")}
                        </span>
                      )}
                      {membership.hasUncommittedChanges && (
                        <span className="rounded border border-rose-800/80 bg-rose-950/40 px-1.5 py-0.5 text-[10px] text-rose-300">
                          uncommitted changes
                        </span>
                      )}
                    </div>
                  )}
                  {membership && (membership.changedFiles?.length ?? 0) > 0 && (
                    <div className="pl-6 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        Changed files
                      </p>
                      <ul className="max-h-40 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 text-[11px] text-zinc-300 font-mono">
                        {membership.changedFiles!.map((file) => (
                          <li key={file} className="truncate" title={file}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {projectRepos.length > 0 && (
          <Button type="button" size="sm" disabled={busy} onClick={() => void saveMemberships()}>
            Save repository membership
          </Button>
        )}
        {memberships.some((m) => !repoNameById.has(m.projectRepositoryId)) && (
          <p className="text-[11px] text-amber-300/90">
            Some memberships reference repositories no longer listed on the project.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Related tasks</h2>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks in this workspace yet.</p>
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
          <label className="block space-y-1 text-xs text-zinc-400">
            Settings overrides (JSON)
            <textarea value={overrideJson} onChange={(e) => setOverrideJson(e.target.value)} rows={5} className={`${inputClass} font-mono text-xs`} />
          </label>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>Save</Button>
        </form>
      </section>
    </div>
  );
}
