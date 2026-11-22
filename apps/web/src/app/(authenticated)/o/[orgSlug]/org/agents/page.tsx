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
  Bot,
  Cpu,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";

type StatusFilter = "all" | "enabled" | "disabled";

export default function AgentRegistry() {
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const orgUrl = useOrgPath();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const agents = useQuery({
    queryKey: ["org", orgId, "agent-registry"],
    queryFn: () => workflowService.listAgents(),
    refetchOnMount: "always",
  });

  const filteredAgents = useMemo(() => {
    const rows = agents.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((agent) => {
      const enabled = agent.enabled !== false;
      if (statusFilter === "enabled" && !enabled) return false;
      if (statusFilter === "disabled" && enabled) return false;
      if (!q) return true;
      const modelLabel =
        ("model" in agent.backend && agent.backend.model) ||
        (agent.backend.type === "process"
          ? agent.backend.command
          : agent.backend.type === "webhook"
            ? agent.backend.url
            : "Runtime default");
      return (
        agent.name.toLowerCase().includes(q) ||
        (agent.description ?? "").toLowerCase().includes(q) ||
        agent.backend.type.toLowerCase().includes(q) ||
        (agent.backend.provider ?? "").toLowerCase().includes(q) ||
        String(modelLabel).toLowerCase().includes(q)
      );
    });
  }, [agents.data, search, statusFilter]);

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const agent = await workflowService.createAgent();
      router.push(orgUrl(`/org/agents/${agent.id}`));
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
              href={orgUrl("/org/agents")}
              aria-current="page"
              className="inline-flex min-h-7 items-center rounded px-1 font-medium text-zinc-200 hover:underline"
            >
              Agent registry
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">Agent registry</h1>
              {agents.data ? (
                <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-400">
                  {filteredAgents.length === agents.data.length
                    ? `${agents.data.length}`
                    : `${filteredAgents.length} of ${agents.data.length}`}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-zinc-400">
              Agents exist independently of graph nodes. Reuse any registered agent in multiple workflows.
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={agents.isFetching || busy}
            onClick={() => void agents.refetch()}
            className="gap-1.5 text-xs cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 shrink-0 ${agents.isFetching ? "animate-spin" : ""}`}
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
            Create agent
          </Button>
        </div>
      </div>

      {/* Search & Status Filter Toolbar */}
      {(agents.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <search className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search agents"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents by name, provider, model…"
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear agent search"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </search>

          <div
            role="group"
            aria-label="Filter agents by status"
            className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5"
          >
            {(["all", "enabled", "disabled"] as StatusFilter[]).map((item) => {
              const active = statusFilter === item;
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(item)}
                  className={`min-h-7 rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    active ? "bg-indigo-600 text-white shadow-xs" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {agents.isPending && (
        <div role="status" className="space-y-3">
          <span className="sr-only">Loading agents…</span>
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
      {(error || agents.error) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error || agents.error?.message}
          </span>
          <Button variant="outline" size="sm" onClick={() => void agents.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty Registry State */}
      {agents.data?.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-12 text-center space-y-3">
          <Bot className="mx-auto h-8 w-8 text-zinc-500" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-200">No agents yet. Create one to configure it.</p>
          <p className="mx-auto max-w-md text-xs text-zinc-500">
            Configure LLM API, CLI, process, or webhook agents and bind them to multiple workflow nodes.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create first agent
          </Button>
        </div>
      )}

      {/* Empty Filtered State */}
      {(agents.data?.length ?? 0) > 0 && filteredAgents.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-300">No agents match your filter.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            Reset filter
          </Button>
        </div>
      )}

      {/* Agent Cards Grid */}
      {filteredAgents.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent) => {
            const enabled = agent.enabled !== false;
            const modelLabel =
              ("model" in agent.backend && agent.backend.model) ||
              (agent.backend.type === "process"
                ? agent.backend.command
                : agent.backend.type === "webhook"
                  ? agent.backend.url
                  : "Runtime default");
            return (
              <li
                key={agent.id}
                className="project-card group flex flex-col justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/65"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
                        <Bot className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <Link
                        className="card-link truncate text-base font-semibold text-zinc-100 transition-colors group-hover:text-indigo-300"
                        href={orgUrl(`/org/agents/${agent.id}`)}
                      >
                        {agent.name}
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
                    {agent.description || "No description."}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-3 text-xs text-zinc-400">
                  <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-zinc-300">
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
                    <span className="truncate">
                      {agent.backend.type} / {agent.backend.provider} / {modelLabel}
                    </span>
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
