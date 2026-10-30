"use client";

import React, { useMemo } from "react";
import {
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  TASK_COLUMNS,
  TASK_PRIORITIES,
  TaskPriority,
  TaskStatus,
} from "@/lib/taskStatus";
import {
  ActiveFilterChip,
  DEFAULT_TASK_BOARD_FILTERS,
  TaskBoardFilters,
  TaskFilterOperationalState,
  countActiveFilters,
  getActiveFilterChips,
} from "@/lib/taskBoardView";
import { Button } from "@/components/ui/button";

export interface TaskFilterBarProps {
  filters: TaskBoardFilters;
  onFilterChange: <K extends keyof TaskBoardFilters>(key: K, value: TaskBoardFilters[K]) => void;
  onResetFilters: () => void;
  totalTaskCount: number;
  filteredTaskCount: number;
  workspaces: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
  workspaceNamesById: Map<string, string>;
  projectNamesById: Map<string, string>;
  workflowsById: Map<string, string>;
}

export function TaskFilterBar({
  filters,
  onFilterChange,
  onResetFilters,
  totalTaskCount,
  filteredTaskCount,
  workspaces,
  projects,
  agents,
  workflows,
  workspaceNamesById,
  projectNamesById,
  workflowsById,
}: TaskFilterBarProps) {
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  const agentsById = useMemo(
    () => new Map(agents.map((a) => [a.name, a.name])),
    [agents],
  );

  const chips: ActiveFilterChip[] = useMemo(
    () =>
      getActiveFilterChips(filters, {
        workspaceNamesById,
        projectNamesById,
        workflowsById,
        agentsById,
      }),
    [filters, workspaceNamesById, projectNamesById, workflowsById, agentsById],
  );

  const handleRemoveChip = (key: keyof TaskBoardFilters) => {
    onFilterChange(key, DEFAULT_TASK_BOARD_FILTERS[key]);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Primary filter controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search input */}
        <div className="relative min-w-[200px] flex-1 sm:flex-initial">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFilterChange("search", e.target.value)}
            placeholder="Search tasks..."
            className="h-8 w-full sm:w-56 rounded-lg border border-zinc-800 bg-zinc-900 pl-8 pr-7 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onFilterChange("search", "")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Workspace select */}
        <select
          value={filters.workspaceId ?? "all"}
          onChange={(e) => onFilterChange("workspaceId", e.target.value)}
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.workspaceId && filters.workspaceId !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by workspace"
        >
          <option value="all">All workspaces</option>
          <option value="unassigned">Unassigned workspace</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>

        {/* Project select */}
        <select
          value={filters.projectId ?? "all"}
          onChange={(e) => onFilterChange("projectId", e.target.value)}
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.projectId && filters.projectId !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by project"
        >
          <option value="all">All projects</option>
          <option value="unassigned">Unassigned project</option>
          {projects.map((proj) => (
            <option key={proj.id} value={proj.id}>
              {proj.name}
            </option>
          ))}
        </select>

        {/* Status select */}
        <select
          value={filters.status ?? "all"}
          onChange={(e) => onFilterChange("status", e.target.value as TaskStatus | "all")}
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.status && filters.status !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by status"
        >
          <option value="all">All statuses</option>
          {TASK_COLUMNS.map((col) => (
            <option key={col.id} value={col.id}>
              {col.label} (column)
            </option>
          ))}
          <option disabled>──────────</option>
          <option value="backlog">Backlog</option>
          <option value="ready">Ready</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="blocked">Blocked</option>
          <option value="waiting_for_human">Waiting for Human</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {/* Priority select */}
        <select
          value={filters.priority}
          onChange={(e) => onFilterChange("priority", e.target.value as TaskPriority | "all")}
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.priority !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by priority"
        >
          <option value="all">All priorities</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)} priority
            </option>
          ))}
        </select>

        {/* Agent select */}
        <select
          value={filters.agent}
          onChange={(e) => onFilterChange("agent", e.target.value)}
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.agent !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by agent"
        >
          <option value="all">All agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.name}>
              {agent.name}
            </option>
          ))}
          <option value="unassigned">Unassigned</option>
        </select>

        {/* Workflow select */}
        <select
          value={filters.workflow}
          onChange={(e) => onFilterChange("workflow", e.target.value)}
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.workflow !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by workflow"
        >
          <option value="all">All workflows</option>
          {workflows.map((wf) => (
            <option key={wf.id} value={wf.id}>
              {wf.name}
            </option>
          ))}
          <option value="unassigned">No workflow</option>
        </select>

        {/* Operational state select */}
        <select
          value={filters.operationalState ?? "all"}
          onChange={(e) =>
            onFilterChange("operationalState", e.target.value as TaskFilterOperationalState)
          }
          className={`h-8 rounded-lg border bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            filters.operationalState && filters.operationalState !== "all"
              ? "border-indigo-500/70 text-indigo-200"
              : "border-zinc-800"
          }`}
          title="Filter by state (paused, blocked)"
        >
          <option value="all">All states</option>
          <option value="paused">Paused</option>
          <option value="blocked">Blocked (has dependencies)</option>
        </select>

        {/* Right side stats and clear */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-zinc-400">
            {activeCount > 0 ? (
              <span>
                Showing <strong className="text-zinc-200">{filteredTaskCount}</strong> of{" "}
                <strong className="text-zinc-200">{totalTaskCount}</strong> tasks
              </span>
            ) : (
              <span>
                <strong className="text-zinc-200">{totalTaskCount}</strong> tasks
              </span>
            )}
          </span>

          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Active filter chips row */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 mr-1">
            <SlidersHorizontal className="h-3 w-3" />
            Filters:
          </span>
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-200"
            >
              <span className="text-zinc-400">{chip.category}:</span>
              <span className="font-medium text-zinc-100">{chip.label}</span>
              <button
                type="button"
                onClick={() => handleRemoveChip(chip.key)}
                className="ml-0.5 rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 cursor-pointer"
                title={`Remove ${chip.category} filter`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onResetFilters}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer ml-1"
          >
            Clear all ({chips.length})
          </button>
        </div>
      )}
    </div>
  );
}
