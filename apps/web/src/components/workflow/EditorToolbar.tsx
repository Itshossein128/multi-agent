"use client";

import React from "react";
import {
  CircleCheck,
  Maximize,
  Play,
  Redo2,
  Save,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { runService } from "@/services/runService";

function ToolButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60 text-zinc-300 transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "cursor-pointer hover:border-zinc-600 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

export function EditorToolbar() {
  const router = useRouter();
  const [runInput, setRunInput] = React.useState("");
  const definition = useWorkflowStore((s) => s.definition);
  const agents = useWorkflowStore((s) => s.agents);
  const tools = useWorkflowStore((s) => s.tools);
  const issues = useWorkflowStore((s) => s.issues);
  const name = useWorkflowStore((s) => s.definition.name);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const saveState = useWorkflowStore((s) => s.saveState);
  const canUndo = useWorkflowStore((s) => s.canUndo);
  const canRedo = useWorkflowStore((s) => s.canRedo);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useWorkflowStore((s) => s.selectedEdgeIds);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const removeSelection = useWorkflowStore((s) => s.removeSelection);

  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
  const isSaving = saveState === "saving";
  const hasErrors = issues.some((issue) => issue.severity === "error");

  return (
    <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/80 px-3">
      <input
        type="text"
        value={name}
        onChange={(event) => setWorkflowName(event.target.value)}
        placeholder="Workflow name"
        className="h-8 w-52 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-semibold text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {isDirty ? (
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          Unsaved
        </span>
      ) : (
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">Saved</span>
      )}

      <div className="mx-1 h-5 w-px bg-zinc-800" />

      <ToolButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Delete selected nodes/edges (Del)"
        disabled={!hasSelection}
        onClick={() => removeSelection(selectedNodeIds, selectedEdgeIds)}
      >
        <Trash2 className="h-4 w-4" />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-zinc-800" />

      <ToolButton title="Zoom out" onClick={() => zoomOut()}>
        <ZoomOut className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="Zoom in" onClick={() => zoomIn()}>
        <ZoomIn className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="Fit view" onClick={() => fitView({ duration: 300 })}>
        <Maximize className="h-4 w-4" />
      </ToolButton>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const firstError = useWorkflowStore
              .getState()
              .issues.find((issue) => issue.severity === "error");
            if (firstError) {
              useWorkflowStore.getState().focusIssue(firstError);
            }
          }}
          className="h-8 cursor-pointer gap-1.5 text-xs"
        >
          <CircleCheck className="h-3.5 w-3.5" />
          Validate
        </Button>
        <input
          aria-label="Run input"
          type="text"
          value={runInput}
          onChange={(event) => setRunInput(event.target.value)}
          placeholder="Run input"
          className="h-8 w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <Button
          size="sm"
          disabled={hasErrors}
          onClick={async () => {
            try {
              const { runId } = await runService.startRun(definition, agents, { input: runInput }, undefined, tools);
              sessionStorage.setItem(`run-definition:${runId}`, JSON.stringify(definition));
              router.push(`/runs/${runId}`);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : String(error));
            }
          }}
          className="h-8 cursor-pointer gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
        >
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button
          size="sm"
          onClick={() => saveWorkflow()}
          disabled={isSaving}
          className="h-8 cursor-pointer gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
        >
          <Save className={cn("h-3.5 w-3.5", isSaving && "animate-pulse")} />
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
