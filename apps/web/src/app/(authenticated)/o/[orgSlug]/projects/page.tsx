"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, FolderKanban, Plus, RefreshCw, Search, X } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { ProjectCard, type ProjectEntityRow } from "@/components/projects/ProjectCard";
import {
  ProjectFormDialog,
  type ProjectFormValues,
} from "@/components/projects/ProjectFormDialog";
import { RetireProjectDialog } from "@/components/projects/RetireProjectDialog";
import { Button } from "@/components/ui/button";
import { scopedApiPath } from "@/lib/orgRoute";
import { toast } from "@/store/useToastStore";

type StatusFilter = "active" | "retired" | "all";
type SortOrder = "updated" | "name" | "newest";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
];

/** Projects index page with search, status filtering, sorting, and accessible CRUD dialogs. */
export default function ProjectsPage() {
  const orgUrl = useOrgPath();
  const searchId = useId();
  const sortId = useId();

  const [items, setItems] = useState<ProjectEntityRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("updated");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectEntityRow | null>(null);
  const [retiringProject, setRetiringProject] = useState<ProjectEntityRow | null>(null);

  const load = useCallback(async (status: StatusFilter, showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(
        scopedApiPath(`/api/projects?status=${encodeURIComponent(status)}`),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load projects");
      setItems(Array.isArray(body) ? body : []);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch(scopedApiPath(`/api/projects?status=${encodeURIComponent(statusFilter)}`))
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load projects");
        if (!active) return;
        setItems(Array.isArray(body) ? body : []);
        setError(null);
        setLoaded(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load projects");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [statusFilter]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q),
        )
      : items;

    return [...matched].sort((a, b) => {
      if (sortOrder === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortOrder === "newest") {
        return (
          new Date(b.createdAt ?? b.updatedAt).getTime() -
          new Date(a.createdAt ?? a.updatedAt).getTime()
        );
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [items, search, sortOrder]);

  function selectStatus(status: StatusFilter) {
    if (status === statusFilter) return;
    setLoading(true);
    setError(null);
    setStatusFilter(status);
  }

  async function handleCreateProject(values: ProjectFormValues) {
    const payload: { name?: string; description?: string } = {};
    if (values.name) payload.name = values.name;
    if (values.description) payload.description = values.description;
    const res = await fetch(scopedApiPath("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Create failed");
    toast(`Created "${body.name ?? "Untitled project"}"`);
    if (statusFilter === "retired") {
      selectStatus("active");
    } else {
      await load(statusFilter);
    }
  }

  async function handleEditProject(values: ProjectFormValues) {
    if (!editingProject) return;
    const res = await fetch(
      scopedApiPath(`/api/projects/${encodeURIComponent(editingProject.id)}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
        }),
      },
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Save failed");
    toast(`Updated "${body.name ?? values.name}"`);
    await load(statusFilter);
  }

  async function handleRetireProject(id: string) {
    const targetName = retiringProject?.name ?? "Project";
    const res = await fetch(scopedApiPath("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retire", id }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Retire failed");
    toast(`Retired "${targetName}"`);
    await load(statusFilter);
  }

  const editInitialValues = useMemo(
    () =>
      editingProject
        ? { name: editingProject.name, description: editingProject.description }
        : undefined,
    [editingProject],
  );

  const createInitialValues = useMemo(
    () => (createOpen ? { name: "", description: "" } : undefined),
    [createOpen],
  );

  const hasFilters = Boolean(search.trim()) || statusFilter !== "active";
  const showEmptyWorkspace =
    loaded && !loading && !error && items.length === 0 && !hasFilters;
  const showEmptyFiltered =
    loaded && !loading && !error && filteredItems.length === 0 && !showEmptyWorkspace;

  return (
    <PageContainer>
      {/* Page Header */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <FolderKanban className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">
                Projects
              </h1>
              {loaded ? (
                <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-400">
                  {filteredItems.length === items.length
                    ? `${items.length}`
                    : `${filteredItems.length} of ${items.length}`}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-zinc-400">
              Browse projects and open a dashboard for related tasks, repositories, and workspaces.
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load(statusFilter)}
            className="gap-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 shrink-0 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            New project
          </Button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <search className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search projects
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects…"
            className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </search>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter projects by status"
            className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5"
          >
            {STATUS_OPTIONS.map((option) => {
              const active = statusFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectStatus(option.value)}
                  className={`min-h-7 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    active
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center">
            <label htmlFor={sortId} className="sr-only">
              Sort projects
            </label>
            <select
              id={sortId}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
              className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="updated">Sort: Recently updated</option>
              <option value="name">Sort: Name (A–Z)</option>
              <option value="newest">Sort: Newest first</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load(statusFilter)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {/* Loading Skeleton */}
      {loading && !loaded ? (
        <div
          aria-busy="true"
          aria-label="Loading projects"
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          {[0, 1, 2, 3].map((slot) => (
            <div
              key={slot}
              className="h-40 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-zinc-800" />
                <div className="h-4 w-40 rounded bg-zinc-800" />
              </div>
              <div className="mt-4 h-3 w-full rounded bg-zinc-800/80" />
              <div className="mt-2 h-3 w-2/3 rounded bg-zinc-800/60" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Empty Workspace State */}
      {showEmptyWorkspace ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <FolderKanban className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-sm font-semibold text-zinc-100">No projects yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">
            Create your first project to organize repositories, workspaces, and agent tasks — or jump straight into Tasks to create one inline.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Create first project
            </Button>
            <Link
              href={orgUrl("/tasks")}
              className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-800 px-3 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Go to tasks
            </Link>
          </div>
        </div>
      ) : null}

      {/* Empty Filtered State */}
      {showEmptyFiltered ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            {search.trim()
              ? `No ${statusFilter === "all" ? "" : `${statusFilter} `}projects matching "${search.trim()}".`
              : `No ${statusFilter} projects found.`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Try adjusting your search query or switching status filter.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {search.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSearch("")}
              >
                Clear search
              </Button>
            ) : null}
            {statusFilter !== "active" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectStatus("active")}
              >
                Show active projects
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Project Cards Grid */}
      {loaded && filteredItems.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredItems.map((item) => (
            <li key={item.id} className="min-w-0">
              <ProjectCard
                project={item}
                href={orgUrl(`/projects/${encodeURIComponent(item.id)}`)}
                busy={loading}
                onEdit={(project) => setEditingProject(project)}
                onRetire={(project) => setRetiringProject(project)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {/* Create Dialog */}
      <ProjectFormDialog
        open={createOpen}
        mode="create"
        initialValues={createInitialValues}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateProject}
      />

      {/* Edit Dialog */}
      <ProjectFormDialog
        open={Boolean(editingProject)}
        mode="edit"
        initialValues={editInitialValues}
        projectTitle={editingProject?.name}
        onClose={() => setEditingProject(null)}
        onSubmit={handleEditProject}
      />

      {/* Retire Confirmation Dialog */}
      <RetireProjectDialog
        project={retiringProject}
        onClose={() => setRetiringProject(null)}
        onConfirm={handleRetireProject}
      />
    </PageContainer>
  );
}
