"use client";

import { useOrgPath } from "@/components/organization/OrgProvider";

import { scopedApiPath } from "@/lib/orgRoute";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Archive,
  Boxes,
  Check,
  CheckSquare,
  Copy,
  FolderGit2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { toast } from "@/store/useToastStore";

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
  const orgUrl = useOrgPath();
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
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.workspace.id);
      setCopiedId(true);
      toast("Workspace ID copied");
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      toast("Unable to copy ID", "error");
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(scopedApiPath(`/api/workspaces/${encodeURIComponent(workspaceId)}?dashboard=1`));
      const body = (await res.json()) as DashboardPayload;
      if (!res.ok) throw new Error((body as unknown as { error?: string }).error ?? "Failed to load workspace dashboard");
      setData(body);
      setName(body.workspace.name);
      setDescription(body.workspace.description ?? "");
      setOverrideJson(JSON.stringify(body.workspace.settingsOverrides ?? {}, null, 2));
      setMemberships(body.repositories ?? []);

      const projectId = body.workspace.projectId ?? body.project?.id;
      if (projectId) {
        const repoRes = await fetch(scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}/repositories`));
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
      const res = await fetch(scopedApiPath(`/api/workspaces/${encodeURIComponent(workspaceId)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, settingsOverrides }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      await load();
      toast("Workspace saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
      toast(message, "error");
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
      const res = await fetch(scopedApiPath(`/api/workspaces/${encodeURIComponent(workspaceId)}`), {
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
      const res = await fetch(scopedApiPath(`/api/workspaces/${encodeURIComponent(workspaceId)}`), {
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
      const res = await fetch(scopedApiPath(`/api/workspaces/${encodeURIComponent(workspaceId)}/repositories`), {
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
      <PageContainer className="space-y-3">
        <p role="alert" className="text-sm text-red-300">{error}</p>
        <Button onClick={() => void load()}>Retry</Button>
        <Link href={orgUrl("/workspaces")} className="text-sm text-indigo-300 hover:underline block">← Workspaces</Link>
      </PageContainer>
    );
  }

  if (!data) return <PageContainer className="text-sm text-zinc-400">Loading workspace…</PageContainer>;

  const projectId = data.workspace.projectId ?? data.project?.id;
  const projectName = data.project?.name ?? data.relatedProjects[0]?.name;
  const overriddenKeys = data.workspace.overriddenKeys ?? Object.keys(data.workspace.settingsOverrides ?? {});
  const isRetired = data.workspace.status === "retired";

  return (
    <PageContainer className="space-y-6">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumbs" className="breadcrumb text-xs text-zinc-400">
        <ol className="flex flex-wrap items-center">
          <li>
            <Link
              href={orgUrl("/workspaces")}
              className="inline-flex min-h-6 items-center rounded text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Workspaces
            </Link>
          </li>
          <li>
            <Link
              href={orgUrl(`/workspaces/${encodeURIComponent(data.workspace.id)}`)}
              aria-current="page"
              className="inline-flex min-h-6 max-w-full items-center break-all rounded font-medium text-zinc-100 hover:underline"
            >
              {data.workspace.name}
            </Link>
          </li>
        </ol>
      </nav>

      {/* Workspace Header */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <Boxes className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-bold tracking-tight text-zinc-100">
                {data.workspace.name}
              </h1>
              <span
                className={
                  isRetired
                    ? "inline-flex items-center rounded-full border border-amber-500/30 bg-amber-950/30 px-2.5 py-0.5 text-xs font-medium text-amber-300"
                    : "inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-0.5 text-xs font-medium text-emerald-400"
                }
              >
                {data.workspace.status}
              </span>
            </div>

            {projectId && (
              <p className="text-xs text-zinc-400">
                Project:{" "}
                <Link
                  href={orgUrl(`/projects/${encodeURIComponent(projectId)}`)}
                  className="font-medium text-indigo-300 hover:underline"
                >
                  {projectName ?? projectId}
                </Link>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void handleCopyId()}
                aria-label={`Copy ID for ${data.workspace.name}`}
                title="Copy workspace ID"
                className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
              >
                <span className="truncate max-w-[220px]">{data.workspace.id}</span>
                {copiedId ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void load()}
            className="gap-1.5 text-xs cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
          {data.workspace.status === "active" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void retire()}
              className="gap-1.5 text-xs text-zinc-400 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Retire
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Active repositories
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {memberships.length} / {projectRepos.length}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Related tasks
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{data.tasks.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Setting overrides
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{overriddenKeys.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-100">Repository membership</h2>
            </div>
            {projectRepos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                No project repositories yet.{" "}
                {projectId && (
                  <Link href={orgUrl(`/projects/${encodeURIComponent(projectId)}`)} className="text-indigo-300 hover:underline">
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
                    <li key={repo.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3.5 py-2.5 space-y-2">
                      <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRepo(repo.id)}
                          className="h-3.5 w-3.5 accent-indigo-500"
                        />
                        <span className="truncate font-medium">{repo.name}</span>
                        <span className="text-[11px] text-zinc-500 truncate font-mono">{repo.source}</span>
                      </label>
                      {membership && (
                        <div className="flex flex-wrap items-center gap-2 pl-6">
                          <label className="flex items-center gap-2 text-xs text-zinc-400">
                            Branch
                            <input
                              value={membership.branch}
                              onChange={(e) => setBranch(repo.id, e.target.value)}
                              className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            />
                          </label>
                          {membership.availability && membership.availability !== "ready" && (
                            <span className="rounded-full border border-amber-800/80 bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-300">
                              {membership.availability.replace("_", " ")}
                            </span>
                          )}
                          {membership.hasUncommittedChanges && (
                            <span className="rounded-full border border-rose-800/80 bg-rose-950/40 px-2 py-0.5 text-[10px] text-rose-300">
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

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Settings overrides</h2>
              {overriddenKeys.length > 0 && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void clearOverrides()}>
                  Clear overrides
                </Button>
              )}
            </div>
            {overriddenKeys.length > 0 ? (
              <p className="text-xs text-amber-300">Overridden keys: {overriddenKeys.join(", ")}</p>
            ) : (
              <p className="text-xs text-zinc-500">No overrides — inheriting project settings.</p>
            )}
            {data.workspace.effectiveSettings && (
              <details className="text-xs text-zinc-400">
                <summary className="cursor-pointer font-medium text-zinc-300">Effective settings</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[11px] text-zinc-300">
                  {JSON.stringify(data.workspace.effectiveSettings, null, 2)}
                </pre>
              </details>
            )}
          </section>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-100">Related tasks</h2>
            </div>
            {data.tasks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                No tasks in this workspace yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3.5 py-2.5 text-sm"
                  >
                    <Link
                      href={orgUrl(`/tasks?taskId=${encodeURIComponent(task.id)}`)}
                      className="font-medium text-indigo-300 hover:underline"
                    >
                      {task.title}
                    </Link>
                    <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                      {task.status} · {task.priority}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-100">Configuration</h2>
            </div>
            <form onSubmit={saveConfig} className="space-y-3">
              <label className="block space-y-1 text-xs font-medium text-zinc-300">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${inputClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                />
              </label>
              <label className="block space-y-1 text-xs font-medium text-zinc-300">
                <span>Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={`${inputClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                />
              </label>
              <label className="block space-y-1 text-xs font-medium text-zinc-300">
                <span>Settings overrides (JSON)</span>
                <textarea
                  value={overrideJson}
                  onChange={(e) => setOverrideJson(e.target.value)}
                  rows={5}
                  className={`${inputClass} font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                />
              </label>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !name.trim()}
                className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
              >
                Save
              </Button>
            </form>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
