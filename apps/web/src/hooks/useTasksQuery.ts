"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TaskBoardData, TaskPriority, TaskStatus } from "@/lib/taskStatus";

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  dependencies?: string[];
  status?: TaskStatus;
}

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  dependencies?: string[];
  output?: string | null;
}

export interface DependencyBlocker {
  id: string;
  title: string;
  status: TaskStatus;
}

export class TaskRequestError extends Error {
  public blockedBy: DependencyBlocker[];
  constructor(message: string, blockedBy: DependencyBlocker[] = []) {
    super(message);
    this.name = "TaskRequestError";
    this.blockedBy = blockedBy;
  }
}

async function fetchBoard(): Promise<TaskBoardData> {
  const res = await fetch("/api/tasks", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load task board: ${res.statusText}`);
  }
  return res.json();
}

async function postTaskAction<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TaskRequestError(json.error ?? `Request failed: ${res.statusText}`, json.blockedBy);
  }
  return json as T;
}

export function useTasksQuery() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchBoard,
    refetchInterval: 3000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const createMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => postTaskAction({ action: "create", ...input }),
    onSuccess: invalidate,
  });

  // Optimistic move: update the cache immediately so drag & drop feels instant,
  // roll back and refetch if the API rejects the transition.
  const moveMutation = useMutation({
    mutationFn: (vars: { taskId: string; toStatus: TaskStatus }) =>
      postTaskAction({ action: "move", taskId: vars.taskId, toStatus: vars.toStatus }),
    onMutate: async ({ taskId, toStatus }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previous = queryClient.getQueryData<TaskBoardData>(["tasks"]);
      queryClient.setQueryData<TaskBoardData>(["tasks"], (old) =>
        old
          ? {
              ...old,
              tasks: old.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, status: toStatus, paused: false, updatedAt: new Date().toISOString() }
                  : t
              ),
            }
          : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["tasks"], context.previous);
      }
    },
    onSettled: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateTaskInput) => {
      const { taskId, ...patch } = input;
      return postTaskAction({ action: "update", taskId, patch });
    },
    onSuccess: invalidate,
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => postTaskAction({ action: "retry", taskId }),
    onSuccess: invalidate,
  });

  const pauseMutation = useMutation({
    mutationFn: (vars: { taskId: string; paused: boolean }) =>
      postTaskAction({ action: vars.paused ? "pause" : "resume", taskId: vars.taskId }),
    onSuccess: invalidate,
  });

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => postTaskAction({ action: "cancel", taskId }),
    onSuccess: invalidate,
  });

  return {
    ...query,
    tasks: query.data?.tasks ?? [],
    agents: query.data?.agents ?? [],
    createTask: createMutation.mutateAsync,
    moveTask: moveMutation.mutateAsync,
    updateTask: updateMutation.mutateAsync,
    retryTask: retryMutation.mutateAsync,
    setTaskPaused: pauseMutation.mutateAsync,
    cancelTask: cancelMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      moveMutation.isPending ||
      updateMutation.isPending ||
      retryMutation.isPending ||
      pauseMutation.isPending ||
      cancelMutation.isPending,
    mutations: {
      create: createMutation,
      move: moveMutation,
      update: updateMutation,
      retry: retryMutation,
      pause: pauseMutation,
      cancel: cancelMutation,
    },
  };
}
