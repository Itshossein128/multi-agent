"use client";

import { useOptionalOrg, useOrgPath } from "@/components/organization/OrgProvider";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";

function impactBadgeClass(impact?: string): string {
  switch (impact) {
    case "high":
    case "destructive":
      return "border-red-500/30 bg-red-950/30 text-red-400";
    case "medium":
    case "write":
    case "network":
      return "border-amber-500/30 bg-amber-950/30 text-amber-400";
    default:
      return "border-zinc-700 bg-zinc-800/70 text-zinc-300";
  }
}

export default function ToolRegistry() {
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const orgUrl = useOrgPath();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const tools = useQuery({
    queryKey: ["org", orgId, "tool-registry"],
    queryFn: () => workflowService.listTools(),
    refetchOnMount: "always",
  });

  const categories = useMemo(() => {
    const set = new Set((tools.data ?? []).map((t) => t.category).filter(Boolean));
    return Array.from(set).sort();
  }, [tools.data]);

  const filteredTools = useMemo(() => {
    const rows = tools.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((tool) => {
      if (categoryFilter !== "all" && tool.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        (tool.description ?? "").toLowerCase().includes(q) ||
        tool.category.toLowerCase().includes(q) ||
        (tool.impact ?? "").toLowerCase().includes(q)
      );
    });
  }, [tools.data, search, categoryFilter]);

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const tool = await workflowService.createTool();
      router.push(orgUrl(`/org/tools/${tool.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <PageContainer>
      {/* Top Breadcrumb Navigation */}
      <nav aria-label="Breadcrumbs" className="breadcrumb flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <ol className="flex flex-wrap items-center">
          <li>
            <Link
              className="inline-flex min-h-7 items-center rounded px-1 text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              href={orgUrl("/org")}
            >
              Graph Editor
            </Link>
          </li>
          <li>
            <Link
              href={orgUrl("/org/tools")}
              aria-current="page"
              className="inline-flex min-h-7 items-center rounded px-1 font-medium text-zinc-200 hover:underline"
            >
              Tool registry
            </Link>
          </li>
        </ol>
        <Link
          className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-xs text-indigo-300 transition-colors hover:bg-zinc-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          href={orgUrl("/org")}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Graph Editor</span>
        </Link>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
            <Wrench className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">Tool registry</h1>
              {tools.data ? (
                <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-400">
                  {filteredTools.length === tools.data.length
                    ? `${tools.data.length}`
                    : `${filteredTools.length} of ${tools.data.length}`}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-zinc-400">
              Tools exist independently of graph nodes. Reuse any registered tool across multiple workflows and agents.
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={tools.isFetching || busy}
            onClick={() => void tools.refetch()}
            className="gap-1.5 text-xs cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 shrink-0 ${tools.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Create tool
          </Button>
        </div>
      </div>

      {/* Search & Category Filter Toolbar */}
      {(tools.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <search className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search tools"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools by name, category, impact…"
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear tool search"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </search>

          {categories.length > 1 && (
            <select
              aria-label="Filter tools by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="studio-select h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  Category: {cat}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {tools.isPending && (
        <div role="status" className="space-y-3">
          <span className="sr-only">Loading tools…</span>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((slot) => (
              <div
                key={slot}
                className="h-36 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
              />
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {(error || tools.error) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error || tools.error?.message}
          </span>
          <Button variant="outline" size="sm" onClick={() => void tools.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty Registry State */}
      {tools.data?.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-12 text-center space-y-3">
          <Wrench className="mx-auto h-8 w-8 text-zinc-500" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-200">No tools yet. Create one to configure it.</p>
          <p className="mx-auto max-w-md text-xs text-zinc-500">
            Register reusable tools with input/output schemas and permission levels for agents and workflows.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create first tool
          </Button>
        </div>
      )}

      {/* Empty Filtered State */}
      {(tools.data?.length ?? 0) > 0 && filteredTools.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-300">No tools match your filter.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setCategoryFilter("all");
            }}
          >
            Reset filter
          </Button>
        </div>
      )}

      {/* Tool Cards Grid */}
      {filteredTools.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTools.map((tool) => {
            const enabled = tool.enabled !== false;
            return (
              <li
                key={tool.id}
                className="project-card group flex flex-col justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/65"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
                        <Wrench className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <Link
                        className="card-link truncate font-mono text-sm font-semibold text-zinc-100 transition-colors group-hover:text-indigo-300"
                        href={orgUrl(`/org/tools/${tool.id}`)}
                      >
                        {tool.name}
                      </Link>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          enabled
                            ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                            : "border-zinc-700 bg-zinc-800/60 text-zinc-400"
                        }`}
                      >
                        {enabled ? "Enabled" : "Disabled"}
                      </span>
                      <ArrowUpRight
                        className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-indigo-400"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <p className="line-clamp-2 break-words text-xs leading-relaxed text-zinc-400">
                    {tool.description || "No description."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3 text-xs text-zinc-400">
                  <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                    {tool.category}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${impactBadgeClass(tool.impact)}`}
                  >
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    {tool.impact}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
