"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  Layers,
  Plus,
  Radio,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DEP_GATED_STATUSES,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  Task,
  TaskPriority,
  TaskStatus,
  canMoveStatus,
  getDependencyBlockers,
} from "@/lib/taskStatus";
import { useTasksQuery, CreateTaskInput, TaskRequestError } from "@/hooks/useTasksQuery";
import { TaskBoardColumn } from "@/components/tasks/TaskBoardColumn";
import { CreateTaskModal } from "@/components/tasks/CreateTaskModal";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export default function TaskBoardPage() {
  const {
    tasks,
    agents,
    isLoading,
    isError,
    refetch,
    isFetching,
    isMutating,
    createTask,
    moveTask,
    updateTask,
    retryTask,
    setTaskPaused,
    cancelTask,
    mutations,
  } = useTasksQuery();

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<TaskStatus>("todo");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (
        q &&
        !task.title.toLowerCase().includes(q) &&
        !task.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
      if (agentFilter !== "all" && task.assignedAgent !== agentFilter) return false;
      return true;
    });
  }, [tasks, search, priorityFilter, agentFilter]);

  const tasksByStatus = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const column of TASK_COLUMNS) grouped.set(column.status, []);
    for (const task of filteredTasks) {
      grouped.get(task.status)?.push(task);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (byPriority !== 0) return byPriority;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    return grouped;
  }, [filteredTasks]);

  const detailTask = detailTaskId ? tasksById.get(detailTaskId) ?? null : null;

  const mutationError = [mutations.move, mutations.create, mutations.update, mutations.retry, mutations.pause, mutations.cancel]
    .map((m) => m.error)
    .find((e): e is Error => Boolean(e));

  const bannerError = actionError ?? mutationError?.message ?? null;

  const dismissError = () => {
    setActionError(null);
    mutations.move.reset();
    mutations.create.reset();
    mutations.update.reset();
    mutations.retry.reset();
    mutations.pause.reset();
    mutations.cancel.reset();
  };

  const handleMove = async (taskId: string, toStatus: TaskStatus) => {
    setActionError(null);
    const task = tasksById.get(taskId);
    if (!task || task.status === toStatus) return;
    if (!canMoveStatus(task.status, toStatus)) {
      setActionError(
        `Invalid transition: ${task.status.replace("_", " ")} → ${toStatus.replace("_", " ")}`
      );
      return;
    }
    if (DEP_GATED_STATUSES.includes(toStatus)) {
      const blockers = getDependencyBlockers(task, tasksById);
      if (blockers.length > 0) {
        setActionError(
          `"${task.title}" is blocked by unfinished dependencies: ${blockers
            .map((b) => `"${b.title}"`)
            .join(", ")}`
        );
        return;
      }
    }
    try {
      await moveTask({ taskId, toStatus });
    } catch (err) {
      if (err instanceof TaskRequestError && err.blockedBy.length > 0) {
        setActionError(`${err.message}: ${err.blockedBy.map((b) => `"${b.title}"`).join(", ")}`);
      }
    }
  };

  const handleCreate = async (input: CreateTaskInput) => {
    setActionError(null);
    try {
      await createTask(input);
      setModalOpen(false);
    } catch {
      // Error is surfaced through mutations.create.error -> bannerError
    }
  };

  const handleCancelTask = async (task: Task) => {
    setActionError(null);
    try {
      await cancelTask(task.id);
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
              The /api/tasks endpoint is unreachable. Is the web server running?
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
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20 hover:opacity-90"
              title="Back to Dashboard"
            >
              <Layers className="h-5 w-5 text-white" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">TASK BOARD</span>
                <Badge
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900/60 text-[10px] text-zinc-400"
                >
                  {tasks.length} tasks
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-400">
                Plan, dispatch, and track agent work across the pipeline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-400">
              <Radio className="h-3 w-3 animate-pulse" />
              <span>Live · synced {new Date().toLocaleTimeString()}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 cursor-pointer gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => openModal("todo")}
              className="h-8 cursor-pointer gap-1.5 bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              New Task
            </Button>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="mx-auto w-full max-w-[1800px] px-4 pt-4 lg:px-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="h-8 w-56 rounded-lg border border-zinc-800 bg-zinc-900 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "all")}
            className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)} priority
              </option>
            ))}
          </select>

          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name}
              </option>
            ))}
            <option value="">Unassigned</option>
          </select>

          <span className="text-[11px] text-zinc-500">
            Drag cards between columns · click a card for details
          </span>
        </div>

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
        <div className="flex gap-4 overflow-x-auto pb-4">
          {TASK_COLUMNS.map((config) => (
            <TaskBoardColumn
              key={config.status}
              config={config}
              tasks={tasksByStatus.get(config.status) ?? []}
              tasksById={tasksById}
              isMutating={isMutating}
              draggingTaskId={draggingTaskId}
              onOpenTask={(task) => setDetailTaskId(task.id)}
              onMoveTask={handleMove}
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
      </main>

      {/* Create Task Modal (unmounted when closed so form state resets) */}
      {modalOpen && (
        <CreateTaskModal
          defaultStatus={modalDefaultStatus}
          tasks={tasks}
          agents={agents}
          isMutating={mutations.create.isPending}
          errorMessage={mutations.create.error?.message ?? null}
          onClose={() => {
            setModalOpen(false);
            mutations.create.reset();
          }}
          onCreate={handleCreate}
        />
      )}

      {/* Task Detail Panel (keyed by task so switching tasks reseeds the form) */}
      {detailTask && (
        <TaskDetailPanel
          key={detailTask.id}
          task={detailTask}
          tasks={tasks}
          agents={agents}
          isMutating={isMutating}
          errorMessage={
            actionError ??
            mutations.update.error?.message ??
            mutations.retry.error?.message ??
            null
          }
          onClose={() => setDetailTaskId(null)}
          onUpdate={async (input) => {
            setActionError(null);
            await updateTask(input);
          }}
          onMove={handleMove}
          onPauseToggle={(task) => {
            setActionError(null);
            setTaskPaused({ taskId: task.id, paused: !task.paused });
          }}
          onRetry={(task) => {
            setActionError(null);
            retryTask(task.id);
          }}
          onCancel={handleCancelTask}
        />
      )}
    </div>
  );
}
