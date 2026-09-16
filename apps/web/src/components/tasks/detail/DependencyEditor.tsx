"use client";

import { useState } from "react";
import { Link2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCanonicalStatus, Task, statusBadgeConfig } from "@/lib/taskStatus";

interface DependencyEditorProps {
  task: Task;
  tasks: Task[];
  dependencies: string[];
  onAddDependency: (id: string) => void;
  onRemoveDependency: (id: string) => void;
}

/** Editable dependency list with completion indicators and an add selector. */
export function DependencyEditor({
  task,
  tasks,
  dependencies,
  onAddDependency,
  onRemoveDependency,
}: DependencyEditorProps) {
  const [addDependencyId, setAddDependencyId] = useState("");
  const candidates = tasks.filter(
    (t) => t.id !== task.id && !dependencies.includes(t.id),
  );

  const handleAdd = () => {
    if (!addDependencyId || dependencies.includes(addDependencyId)) return;
    onAddDependency(addDependencyId);
    setAddDependencyId("");
  };

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        <Link2 className="h-3 w-3" />
        Dependencies ({dependencies.length})
      </label>
      <div className="space-y-1.5">
        {dependencies.length === 0 && (
          <p className="text-xs text-zinc-600">No dependencies configured.</p>
        )}
        {dependencies.map((depId) => {
          const dep = tasks.find((t) => t.id === depId);
          const depDone = dep && toCanonicalStatus(dep.status) === "completed";
          return (
            <div
              key={depId}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    depDone ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                <span className="truncate text-xs text-zinc-200">
                  {dep?.title ?? "Unknown task"}
                </span>
                <span className="flex-shrink-0 text-[10px] capitalize text-zinc-500">
                  {dep ? statusBadgeConfig(dep.status).label : ""}
                </span>
              </span>
              <button
                type="button"
                title="Remove dependency"
                onClick={() => onRemoveDependency(depId)}
                className="text-zinc-500 hover:text-red-400 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      {candidates.length > 0 && (
        <div className="flex gap-1.5">
          <select
            value={addDependencyId}
            onChange={(e) => setAddDependencyId(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="">Add dependency…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={!addDependencyId}
            className="h-8 w-8 p-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
