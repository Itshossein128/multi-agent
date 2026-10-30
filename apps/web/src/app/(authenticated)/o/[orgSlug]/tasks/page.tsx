"use client";

import { scopedApiPath } from "@/lib/orgRoute";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  TASK_COLUMNS,
  Task,
  TaskStatus,
} from "@/lib/taskStatus";
import {
  DEFAULT_TASK_BOARD_FILTERS,
  TaskBoardFilters,
  filterTasks,
  groupTasksByColumn,
  parseFilterSearchParams,
  serializeFilterSearchParams,
  validateMove,
  validateStart,
} from "@/lib/taskBoardView";
import { useTasksQuery, CreateTaskInput, TaskRequestError } from "@/hooks/useTasksQuery";
import { TaskBoardColumn } from "@/components/tasks/TaskBoardColumn";
import { CreateTaskModal } from "@/components/tasks/CreateTaskModal";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { TaskFilterBar } from "@/components/tasks/TaskFilterBar";
import { TaskFilterEmptyState } from "@/components/tasks/TaskFilterEmptyState";

export default function TaskBoardPage() {
  const {
    tasks,
    agents,
    workflows,
    isLoading,
    isError,
    refetch,
    isMutating,
    createTask,
    moveTask,
    updateTask,
    startTask,
    retryTask,
    setTaskPaused,
    cancelTask,
    deleteTask,
    mutations,
  } = useTasksQuery();

  const [filters, setFilters] = useState<TaskBoardFilters>(DEFAULT_TASK_BOARD_FILTERS);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<TaskStatus>("backlog");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  // Initialize filters from URL on mount & sync back/forward history navigation
  useEffect(() => {
    if (typeof window === "undefined") return;
    const initial = parseFilterSearchParams(new URLSearchParams(window.location.search));
    setFilters(initial);

    const onPopState = () => {
      setFilters(parseFilterSearchParams(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Synchronize active filters to URL search parameters with 200ms debounce
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timeout = setTimeout(() => {
      const serialized = serializeFilterSearchParams(filters);
      const currentParams = new URLSearchParams(window.location.search);
      const linkedTaskId = currentParams.get("taskId");
      if (linkedTaskId) {
        serialized.set("taskId", linkedTaskId);
      }
      const qs = serialized.toString();
      const currentQs = window.location.search.replace(/^\?/, "");
      if (qs !== currentQs) {
        const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
        window.history.replaceState(null, "", nextUrl);
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [filters]);

  useEffect(() => {
    const linkedTaskId = new URLSearchParams(window.location.search).get("taskId");
    if (linkedTaskId && tasks.some(task => task.id === linkedTaskId)) setDetailTaskId(linkedTaskId);
  }, [tasks]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workspaceNamesById, setWorkspaceNamesById] = useState<Map<string, string>>(new Map());
  const [projectNamesById, setProjectNamesById] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wsRes, projRes] = await Promise.all([fetch(scopedApiPath("/api/workspaces")), fetch(scopedApiPath("/api/projects"))]);
        if (!wsRes.ok || !projRes.ok) return;
        const [wsBody, projBody] = await Promise.all([
          wsRes.json() as Promise<Array<{ id: string; name: string }>>,
          projRes.json() as Promise<Array<{ id: string; name: string }>>,
        ]);
        if (cancelled) return;
        setWorkspaces(wsBody);
        setProjects(projBody);
        setWorkspaceNamesById(new Map(wsBody.map((item) => [item.id, item.name])));
        setProjectNamesById(new Map(projBody.map((item) => [item.id, item.name])));
      } catch {
        // Name resolution is best-effort for board chips.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const workflowsById = useMemo(() => new Map(workflows.map((w) => [w.id, w.name])), [workflows]);

  const filteredTasks = useMemo(
    () => filterTasks(tasks, filters, { tasksById }),
    [tasks, filters, tasksById]
  );

  const handleFilterChange = <K extends keyof TaskBoardFilters>(
    key: K,
    value: TaskBoardFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_TASK_BOARD_FILTERS);
  };

  // Separate UI columns from domain status
  const tasksByColumn = useMemo(() => groupTasksByColumn(filteredTasks), [filteredTasks]);

  const detailTask = detailTaskId ? tasksById.get(detailTaskId) ?? null : null;

  const mutationError = [
    mutations.move,
    mutations.create,
    mutations.update,
    mutations.start,
    mutations.retry,
    mutations.pause,
    mutations.cancel,
    mutations.delete,
  ]
    .map((m) => m.error)
    .find((e): e is Error => Boolean(e));

  const bannerError = actionError ?? mutationError?.message ?? null;

  const dismissError = () => {
    setActionError(null);
    mutations.move.reset();
    mutations.create.reset();
    mutations.update.reset();
    mutations.start.reset();
    mutations.retry.reset();
    mutations.pause.reset();
    mutations.cancel.reset();
    mutations.delete.reset();
  };

  const handleMove = async (taskId: string, toStatus: TaskStatus) => {
    setActionError(null);
    const task = tasksById.get(taskId);
    if (!task) return;
    const validation = validateMove(task, toStatus, tasksById);
    if (!validation.ok) {
      setActionError(validation.reason ?? "Move not allowed.");
      return;
    }
    try {
      await moveTask({ taskId, toStatus });
    } catch (err) {
      if (err instanceof TaskRequestError && err.blockedBy.length > 0) {
        setActionError(`${err.message}: ${err.blockedBy.map((b) => `"${b.title}"`).join(", ")}`);
      }
    }
  };

  const handleStart = async (task: Task) => {
    setActionError(null);
    const validation = validateStart(task, tasksById);
    if (!validation.ok) {
      setActionError(validation.reason ?? "Cannot start task.");
      return;
    }
    try {
      await startTask(task.id);
    } catch (err) {
      if (err instanceof TaskRequestError) {
        setActionError(err.message);
      }
    }
  };

  const handleCreate = async (input: CreateTaskInput) => {
    setActionError(null);
    try {
      await createTask(input);
      setModalOpen(false);
    } catch {
      // Error surfaced through mutations.create.error -> bannerError
    }
  };

  const handleCancelTask = async (task: Task) => {
    setActionError(null);
    try {
      await cancelTask(task.id);
    } catch {
      // surfaced via banner
    }
  };

  const handleDeleteTask = async (task: Task) => {
    setActionError(null);
    try {
      await deleteTask(task.id);
      if (detailTaskId === task.id) setDetailTaskId(null);
    } catch {
      // surfaced via banner
    }
  };

  const openModal = (status: TaskStatus) => {
    setModalDefaultStatus(status);
    setModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading task board...
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertOctagon className="h-8 w-8 text-red-400" />
            <p className="text-sm font-medium text-zinc-200">Could not load the task board</p>
            <p className="text-xs text-zinc-500">
              The /api/tasks endpoint is unreachable. Is the server running?
            </p>
            <Button size="sm" onClick={() => refetch()} className="cursor-pointer">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Filter bar */}
      <div className="mx-auto w-full max-w-[1800px] px-4 pt-4 lg:px-8">
        <TaskFilterBar
          filters={filters}
          onFilterChange={handleFilterChange}
          onResetFilters={handleResetFilters}
          totalTaskCount={tasks.length}
          filteredTaskCount={filteredTasks.length}
          workspaces={workspaces}
          projects={projects}
          agents={agents}
          workflows={workflows}
          workspaceNamesById={workspaceNamesById}
          projectNamesById={projectNamesById}
          workflowsById={workflowsById}
        />

        {/* Error banner */}
        {bannerError && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3.5 py-2.5">
            <p className="flex items-center gap-2 text-xs text-red-300">
              <AlertOctagon className="h-3.5 w-3.5 flex-shrink-0" />
              {bannerError}
            </p>
            <button
              type="button"
              onClick={dismissError}
              className="text-xs text-red-400 hover:text-red-200 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Board */}
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-4 lg:px-8">
        {tasks.length > 0 && filteredTasks.length === 0 ? (
          <TaskFilterEmptyState onResetFilters={handleResetFilters} />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {TASK_COLUMNS.map((config) => (
              <TaskBoardColumn
                key={config.id}
                config={config}
                tasks={tasksByColumn.get(config.id) ?? []}
                tasksById={tasksById}
                workflowsById={workflowsById}
                workspaceNamesById={workspaceNamesById}
                projectNamesById={projectNamesById}
                isMutating={isMutating}
                draggingTaskId={draggingTaskId}
                onOpenTask={(task) => setDetailTaskId(task.id)}
                onMoveTask={handleMove}
                onStartTask={handleStart}
                onPauseToggle={(task) => {
                  setActionError(null);
                  setTaskPaused({ taskId: task.id, paused: !task.paused });
                }}
                onCancelTask={handleCancelTask}
                onRetryTask={(task) => {
                  setActionError(null);
                  retryTask(task.id);
                }}
                onAddTask={openModal}
                onDragStartTask={setDraggingTaskId}
                onDragEndTask={() => setDraggingTaskId(null)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create Task Modal */}
      {modalOpen && (
        <CreateTaskModal
          defaultStatus={modalDefaultStatus}
          tasks={tasks}
          agents={agents}
          workflows={workflows}
          isMutating={mutations.create.isPending}
          errorMessage={mutations.create.error?.message ?? null}
          onClose={() => {
            setModalOpen(false);
            mutations.create.reset();
          }}
          onCreate={handleCreate}
        />
      )}

      {/* Task Detail Panel */}
      {detailTask && (
        <TaskDetailPanel
          key={detailTask.id}
          task={detailTask}
          tasks={tasks}
          agents={agents}
          workflows={workflows}
          isMutating={isMutating}
          errorMessage={
            actionError ??
            mutations.update.error?.message ??
            mutations.start.error?.message ??
            mutations.retry.error?.message ??
            null
          }
          onClose={() => setDetailTaskId(null)}
          onUpdate={async (input) => {
            setActionError(null);
            await updateTask(input);
          }}
          onMove={handleMove}
          onStart={handleStart}
          onPauseToggle={(task) => {
            setActionError(null);
            setTaskPaused({ taskId: task.id, paused: !task.paused });
          }}
          onRetry={(task) => {
            setActionError(null);
            retryTask(task.id);
          }}
          onCancel={handleCancelTask}
          onDelete={handleDeleteTask}
        />
      )}
    </div>
  );
}
