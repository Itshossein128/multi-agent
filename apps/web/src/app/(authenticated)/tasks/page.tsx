"use client";

import React, { useMemo, useState } from "react";
import {
  AlertOctagon,
  GitBranch,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ColumnId,
  DEP_GATED_STATUSES,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  Task,
  TaskPriority,
  TaskStatus,
  canMoveStatus,
  getColumnForStatus,
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

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [workflowFilter, setWorkflowFilter] = useState<string>("all");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<TaskStatus>("backlog");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const workflowsById = useMemo(() => new Map(workflows.map((w) => [w.id, w.name])), [workflows]);

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
      if (agentFilter !== "all") {
        const matchesAgent =
          task.assignedAgent === agentFilter ||
          (task.assignedAgents && task.assignedAgents.includes(agentFilter));
        if (!matchesAgent) return false;
      }
      if (workflowFilter !== "all" && task.workflowId !== workflowFilter) return false;
      return true;
    });
  }, [tasks, search, priorityFilter, agentFilter, workflowFilter]);

  // Separate UI columns from domain status
  const tasksByColumn = useMemo(() => {
    const grouped = new Map<ColumnId, Task[]>();
    for (const column of TASK_COLUMNS) grouped.set(column.id, []);
    for (const task of filteredTasks) {
      const colId = getColumnForStatus(task.status);
      grouped.get(colId)?.push(task);
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
    if (!task || task.status === toStatus) return;
    if (!canMoveStatus(task.status, toStatus)) {
      setActionError(
        `Invalid transition: ${task.status.replace("_", " ")} → ${toStatus.replace("_", " ")}`,
      );
      return;
    }
    if (DEP_GATED_STATUSES.includes(toStatus)) {
      const blockers = getDependencyBlockers(task, tasksById);
      if (blockers.length > 0) {
        setActionError(
          `"${task.title}" is blocked by unfinished dependencies: ${blockers
            .map((b) => `"${b.title}"`)
            .join(", ")}`,
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

  const handleStart = async (task: Task) => {
    setActionError(null);
    const blockers = getDependencyBlockers(task, tasksById);
    if (blockers.length > 0) {
      setActionError(
        `Cannot start: blocked by unfinished dependencies: ${blockers
          .map((b) => `"${b.title}"`)
          .join(", ")}`,
      );
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

          <select
            value={workflowFilter}
            onChange={(e) => setWorkflowFilter(e.target.value)}
            className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All workflows</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>

          <span className="text-[11px] text-zinc-500 ml-auto">
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
              key={config.id}
              config={config}
              tasks={tasksByColumn.get(config.id) ?? []}
              tasksById={tasksById}
              workflowsById={workflowsById}
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
