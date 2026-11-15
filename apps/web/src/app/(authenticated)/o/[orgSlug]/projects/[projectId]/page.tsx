"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArrowUpRight,
  Boxes,
  Check,
  CheckSquare,
  Code2,
  Copy,
  FolderGit2,
  FolderKanban,
  GitBranch,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useOrgPath } from "@/components/organization/OrgProvider";
import {
  AttachRepositoryDialog,
} from "@/components/projects/AttachRepositoryDialog";
import {
  CreateWorkspaceDialog,
} from "@/components/projects/CreateWorkspaceDialog";
import {
  ProjectFormDialog,
  type ProjectFormValues,
} from "@/components/projects/ProjectFormDialog";
import {
  RemoveRepositoryDialog,
  type RemoveRepoTarget,
} from "@/components/projects/RemoveRepositoryDialog";
import { RetireProjectDialog } from "@/components/projects/RetireProjectDialog";
import { Button } from "@/components/ui/button";
import { scopedApiPath } from "@/lib/orgRoute";
import { toast } from "@/store/useToastStore";

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

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  workspaceId: string | null;
  projectId: string;
}

interface DashboardPayload {
  project: {
    id: string;
    name: string;
    description: string;
    status: string;
    updatedAt?: string;
    settings?: Record<string, unknown>;
    usesDefaultWorkspace?: boolean;
  };
  usesDefaultWorkspace?: boolean;
  workspaces?: WorkspaceRow[];
  repositories?: RepoRow[];
  tasks: TaskRow[];
  relatedWorkspaces: WorkspaceRow[];
}

function formatSettingValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function ProjectConfigForm({
  initialName,
  initialDescription,
  disabled,
  onSave,
}: {
  initialName: string;
  initialDescription: string;
  disabled: boolean;
  onSave: (values: { name: string; description: string }) => Promise<void>;
}) {
  const nameId = useId();
  const nameErrorId = useId();
  const descId = useId();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty = name !== initialName || description !== initialDescription;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setNameError("Project name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="block text-xs font-medium text-zinc-200">
          Name <span aria-hidden="true" className="text-red-400">*</span>
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          value={name}
          disabled={disabled || saving}
          required
          maxLength={120}
          aria-invalid={nameError ? "true" : undefined}
          aria-describedby={nameError ? nameErrorId : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError && event.target.value.trim()) setNameError(null);
          }}
          onBlur={() => {
            if (!name.trim()) setNameError("Project name is required.");
          }}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 aria-invalid:border-red-500"
        />
        {nameError ? (
          <p
            id={nameErrorId}
            role="alert"
            className="text-xs text-red-400 [html[data-appearance='light']_&]:text-red-700"
          >
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={descId} className="block text-xs font-medium text-zinc-200">
          Description
        </label>
        <textarea
          id={descId}
          name="description"
          rows={3}
          maxLength={600}
          value={description}
          disabled={disabled || saving}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe goals, repositories, or architecture notes…"
          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
        />
      </div>

      {saveError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
        >
          {saveError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-zinc-500">
          {disabled
            ? "Retired projects are read-only."
            : isDirty
              ? "Unsaved changes"
              : "All changes saved"}
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={disabled || saving || !isDirty}
          className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/** Project detail dashboard with semantic breadcrumbs, responsive 2-column layout, and modal workflows. */
export default function ProjectDashboardPage() {
  const orgUrl = useOrgPath();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [attachRepoOpen, setAttachRepoOpen] = useState(false);
  const [removeRepoTarget, setRemoveRepoTarget] = useState<RemoveRepoTarget | null>(null);
  const [showRawSettings, setShowRawSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}?dashboard=1`),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load project dashboard");
      setData(body as DashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project dashboard");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}?dashboard=1`))
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project dashboard");
        if (!active) return;
        setData(body as DashboardPayload);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load project dashboard");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const editInitialValues = useMemo(
    () =>
      data
        ? { name: data.project.name, description: data.project.description ?? "" }
        : undefined,
    [data],
  );

  async function saveConfig(values: ProjectFormValues) {
    const res = await fetch(scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: values.name, description: values.description }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Save failed");
    toast("Project saved");
    await load();
  }

  async function retireProject(id: string) {
    const res = await fetch(scopedApiPath(`/api/projects/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retire" }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Retire failed");
    toast("Project retired");
    await load();
  }

  async function createWorkspace(payload: {
    name?: string;
    repositories?: Array<{ projectRepositoryId: string; branch: string }>;
  }) {
    const res = await fetch(
      scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}/workspaces`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Create workspace failed");
    toast("Workspace created");
    await load();
  }

  async function attachRepo(payload: {
    name: string;
    source: string;
    defaultBranch: string;
  }) {
    const res = await fetch(
      scopedApiPath(`/api/projects/${encodeURIComponent(projectId)}/repositories`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Attach repository failed");
    toast(`Attached "${payload.name}"`);
    await load();
  }

  async function removeRepo(repoId: string, confirmDiscardChanges: boolean) {
    const res = await fetch(
      scopedApiPath(
        `/api/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`,
      ),
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmDiscardChanges ? { confirmDiscardChanges: true } : {}),
      },
    );
    if (res.status === 409 && !confirmDiscardChanges) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      const message = body.error ?? "A workspace has uncommitted changes for this repository.";
      const isDiscardConflict =
        body.code === "CONFIRM_DISCARD_REQUIRED" ||
        /unsaved changes|uncommitted|confirm/i.test(message);
      if (isDiscardConflict) {
        return { conflictMessage: message };
      }
      throw new Error(message);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Remove repository failed");
    }
    toast("Repository removed");
    await load();
  }

  async function handleCopyId() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.project.id);
      setCopiedId(true);
      toast("Project ID copied");
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      toast("Unable to copy ID", "error");
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <nav aria-label="Breadcrumbs" className="breadcrumb text-xs text-zinc-400">
          <ol className="flex flex-wrap items-center">
            <li>
              <Link
                href={orgUrl("/projects")}
                className="inline-flex min-h-6 items-center text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                Projects
              </Link>
            </li>
            <li>
              <Link
                href={orgUrl(`/projects/${encodeURIComponent(projectId)}`)}
                aria-current="page"
                className="inline-flex min-h-6 items-center font-medium text-zinc-200 hover:underline"
              >
                {projectId}
              </Link>
            </li>
          </ol>
        </nav>

        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading project dashboard"
        className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6"
      >
        <div className="h-5 w-44 animate-pulse rounded bg-zinc-800" />
        <div className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((slot) => (
            <div
              key={slot}
              className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40 lg:col-span-7" />
          <div className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40 lg:col-span-5" />
        </div>
      </div>
    );
  }

  const usesDefault = Boolean(data.usesDefaultWorkspace ?? data.project.usesDefaultWorkspace);
  const workspaces = data.workspaces?.length ? data.workspaces : data.relatedWorkspaces;
  const repositories = data.repositories ?? [];
  const projectSettings = data.project.settings ?? {};
  const settingEntries = Object.entries(projectSettings);
  const isRetired = data.project.status === "retired";
  const isActive = !isRetired;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumbs" className="breadcrumb text-xs text-zinc-400">
        <ol className="flex flex-wrap items-center">
          <li>
            <Link
              href={orgUrl("/projects")}
              className="inline-flex min-h-6 items-center rounded text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Projects
            </Link>
          </li>
          <li>
            <Link
              href={orgUrl(`/projects/${encodeURIComponent(data.project.id)}`)}
              aria-current="page"
              className="inline-flex min-h-6 max-w-full items-center break-all rounded font-medium text-zinc-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {data.project.name}
            </Link>
          </li>
        </ol>
      </nav>

      {/* Project Header */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <FolderKanban className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-bold tracking-tight text-zinc-100">
                {data.project.name}
              </h1>
              <span
                className={
                  isRetired
                    ? "inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300 [html[data-appearance='light']_&]:text-amber-700"
                    : "inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400"
                }
              >
                {isRetired ? "Retired" : "Active"}
              </span>
            </div>

            <p className={data.project.description ? "text-sm text-zinc-400" : "text-sm italic text-zinc-500"}>
              {data.project.description || "No description provided yet."}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void handleCopyId()}
                aria-label={`Copy ID for ${data.project.name}`}
                title="Copy project ID"
                className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span className="truncate max-w-[200px]">{data.project.id}</span>
                {copiedId ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
            className="gap-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 shrink-0 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
          {isActive ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
                className="gap-1.5 text-xs"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Edit details
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRetireOpen(true)}
                className="gap-1.5 text-xs text-zinc-400 hover:bg-red-500/10 hover:text-red-400 [html[data-appearance='light']_&]:hover:text-red-700"
              >
                <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Retire
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Notices */}
      {isRetired ? (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 [html[data-appearance='light']_&]:text-amber-700"
        >
          <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            This project is retired and read-only. New workspaces, repositories, and edits are disabled.
          </span>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Workspaces</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {workspaces.length}
            {usesDefault ? (
              <span className="ml-1.5 text-xs font-normal text-zinc-400">(default)</span>
            ) : null}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Repositories</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{repositories.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Tasks</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{data.tasks.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Settings keys</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{settingEntries.length}</p>
        </div>
      </div>

      {/* Main 2-Column Dashboard Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Workspaces & Repositories */}
        <div className="space-y-6 lg:col-span-7">
          {/* Workspaces Section */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-zinc-100">Workspaces</h2>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                  {workspaces.length}
                </span>
              </div>
              {isActive ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={repositories.length === 0}
                  title={
                    repositories.length === 0
                      ? "Attach at least one repository before creating a workspace"
                      : undefined
                  }
                  onClick={() => setCreateWsOpen(true)}
                  className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  New workspace
                </Button>
              ) : null}
            </div>

            {usesDefault ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-3.5 py-2.5 text-xs text-zinc-300">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
                <span>
                  Using default workspace — tasks attach at the project level until you create an explicit workspace.
                </span>
              </div>
            ) : null}

            {isActive && repositories.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-3.5 py-2.5 text-xs text-zinc-400">
                <span>Attach at least one repository before creating a custom workspace.</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttachRepoOpen(true)}
                  className="h-7 text-xs text-indigo-300 hover:text-indigo-200"
                >
                  Attach repository
                </Button>
              </div>
            ) : null}

            {workspaces.length === 0 && !usesDefault ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                No workspaces yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {workspaces.map((ws) => (
                  <li
                    key={ws.id}
                    className="flex flex-col gap-1 rounded-lg border border-zinc-800/90 bg-zinc-950/50 px-3.5 py-2.5 transition-colors hover:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={orgUrl(`/workspaces/${encodeURIComponent(ws.id)}`)}
                        className="inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded text-sm font-medium text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <span className="truncate">{ws.name}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                      </Link>
                      {(ws.overriddenKeys?.length ?? 0) > 0 ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="text-[11px] text-zinc-500">Overrides:</span>
                          {ws.overriddenKeys!.map((key) => (
                            <span
                              key={key}
                              className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 [html[data-appearance='light']_&]:text-amber-700"
                            >
                              {key}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500">{ws.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Repositories Section */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FolderGit2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-zinc-100">Repositories</h2>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                  {repositories.length}
                </span>
              </div>
              {isActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAttachRepoOpen(true)}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Attach repository
                </Button>
              ) : null}
            </div>

            {repositories.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center space-y-2">
                <p className="text-xs text-zinc-400">No repositories attached to this project yet.</p>
                {isActive ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAttachRepoOpen(true)}
                    className="gap-1.5 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Attach your first repository
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="space-y-2">
                {repositories.map((repo) => (
                  <li
                    key={repo.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800/90 bg-zinc-950/50 px-3.5 py-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-zinc-100">{repo.name}</p>
                        <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                          <GitBranch className="h-3 w-3 text-zinc-500" aria-hidden="true" />
                          {repo.defaultBranch}
                        </span>
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          {repo.status}
                        </span>
                      </div>
                      <p className="truncate font-mono text-xs text-zinc-500" title={repo.source}>
                        {repo.source}
                      </p>
                    </div>
                    {isActive ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${repo.name}`}
                        onClick={() =>
                          setRemoveRepoTarget({ id: repo.id, name: repo.name, source: repo.source })
                        }
                        className="h-8 gap-1.5 px-2.5 text-xs text-zinc-400 hover:bg-red-500/10 hover:text-red-400 [html[data-appearance='light']_&]:hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right Column: Related Tasks, Configuration, Inherited Settings */}
        <div className="space-y-6 lg:col-span-5">
          {/* Related Tasks Section */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-zinc-100">Related tasks</h2>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                  {data.tasks.length}
                </span>
              </div>
              <Link
                href={orgUrl("/tasks")}
                className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-indigo-300 hover:bg-zinc-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Open tasks board
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            {data.tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center space-y-2">
                <p className="text-xs text-zinc-500">No tasks linked to this project yet.</p>
                <Link
                  href={orgUrl("/tasks")}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-800 px-3 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                  Create task
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-col gap-1.5 rounded-lg border border-zinc-800/90 bg-zinc-950/50 px-3.5 py-2.5 transition-colors hover:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                  >
                    <Link
                      href={orgUrl(`/tasks?taskId=${encodeURIComponent(task.id)}`)}
                      className="inline-flex min-h-7 max-w-full min-w-0 flex-1 items-center gap-1.5 rounded text-sm font-medium text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <span className="truncate">{task.title}</span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                      <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300">
                        {task.status.replaceAll("_", " ")}
                      </span>
                      <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 capitalize text-zinc-400">
                        {task.priority}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Configuration Section */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-100">Configuration</h2>
            </div>

            <ProjectConfigForm
              key={`${data.project.updatedAt ?? ""}:${data.project.name}:${data.project.description}`}
              initialName={data.project.name}
              initialDescription={data.project.description ?? ""}
              disabled={isRetired}
              onSave={saveConfig}
            />
          </section>

          {/* Inherited Settings Section */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-zinc-100">
                  Inherited settings
                </h2>
              </div>
              {settingEntries.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={showRawSettings}
                  onClick={() => setShowRawSettings((prev) => !prev)}
                  className="inline-flex min-h-7 items-center rounded-md px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {showRawSettings ? "Table view" : "Raw JSON"}
                </button>
              ) : null}
            </div>

            <p className="text-xs text-zinc-500">
              Inherited by workspaces unless overridden at the workspace level.
            </p>

            {settingEntries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3.5 py-4 text-center text-xs text-zinc-500">
                No project settings configured yet.
              </p>
            ) : showRawSettings ? (
              <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[11px] text-zinc-300">
                {JSON.stringify(projectSettings, null, 2)}
              </pre>
            ) : (
              <dl className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-950/50">
                {settingEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <dt className="font-mono text-zinc-400">{key}</dt>
                    <dd className="break-all font-mono font-medium text-zinc-100">
                      {formatSettingValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      </div>

      {/* Dialogs */}
      <ProjectFormDialog
        open={editOpen}
        mode="edit"
        initialValues={editInitialValues}
        projectTitle={data.project.name}
        onClose={() => setEditOpen(false)}
        onSubmit={saveConfig}
      />

      <RetireProjectDialog
        project={retireOpen ? { id: data.project.id, name: data.project.name } : null}
        onClose={() => setRetireOpen(false)}
        onConfirm={retireProject}
      />

      <CreateWorkspaceDialog
        open={createWsOpen}
        repositories={repositories}
        onClose={() => setCreateWsOpen(false)}
        onCreate={createWorkspace}
      />

      <AttachRepositoryDialog
        open={attachRepoOpen}
        onClose={() => setAttachRepoOpen(false)}
        onAttach={attachRepo}
      />

      <RemoveRepositoryDialog
        repository={removeRepoTarget}
        onClose={() => setRemoveRepoTarget(null)}
        onRemove={removeRepo}
      />
    </div>
  );
}
