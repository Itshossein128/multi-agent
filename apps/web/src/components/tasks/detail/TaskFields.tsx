"use client";

import { BoardAgent, BoardWorkflow, Task, TaskPriority, TASK_PRIORITIES, toCanonicalStatus } from "@/lib/taskStatus";

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const selectClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500";

interface TaskFieldsProps {
  task: Task;
  tasks: Task[];
  agents: BoardAgent[];
  workflows: BoardWorkflow[];
  isMutating: boolean;
  draft: {
    priority: TaskPriority;
    setPriority: (value: TaskPriority) => void;
    assignedAgent: string;
    setAssignedAgent: (value: string) => void;
    workflowId: string;
    setWorkflowId: (value: string) => void;
    parentTaskId: string;
    setParentTaskId: (value: string) => void;
    description: string;
    setDescription: (value: string) => void;
  };
}

/**
 * Assignment and description fields: priority, agent, workflow, parent task,
 * description, and the read-only execution output. Draft values are owned by
 * the caller (useTaskDraft).
 */
export function TaskFields({ task, tasks, agents, workflows, isMutating, draft }: TaskFieldsProps) {
  const canonical = toCanonicalStatus(task.status);
  const isTerminal = canonical === "completed" || canonical === "failed" || canonical === "cancelled";

  return (
    <>
      {/* Priority + Agent */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Priority</label>
          <select
            value={draft.priority}
            onChange={(e) => draft.setPriority(e.target.value as TaskPriority)}
            disabled={isMutating}
            className={selectClass}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Assigned Agent</label>
          <select
            value={draft.assignedAgent}
            onChange={(e) => draft.setAssignedAgent(e.target.value)}
            disabled={isMutating}
            className={selectClass}
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Workflow + Parent Task */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Workflow</label>
          <select
            value={draft.workflowId}
            onChange={(e) => draft.setWorkflowId(e.target.value)}
            disabled={isMutating}
            className={selectClass}
          >
            <option value="">None (Direct Agent)</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Parent Task</label>
          <select
            value={draft.parentTaskId}
            onChange={(e) => draft.setParentTaskId(e.target.value)}
            disabled={isMutating}
            className={selectClass}
          >
            <option value="">None (Root Task)</option>
            {tasks.filter((t) => t.id !== task.id).map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className={labelClass}>Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => draft.setDescription(e.target.value)}
          disabled={isMutating}
          rows={4}
          className={selectClass}
        />
      </div>

      {/* Final Output / Execution Result (read-only, server-owned) */}
      <div className="space-y-1.5">
        <label className={labelClass}>Final Output / Execution Result</label>
        <textarea
          value={task.output ?? ""}
          readOnly
          placeholder={isTerminal ? "Execution produced no output." : "Execution output will appear here once started."}
          className={`${selectClass} cursor-default opacity-80`}
        />
      </div>
    </>
  );
}
