"use client";

import type { LiveCanvasController } from "./live/liveCanvas.types";

import React from "react";
import {
  CircleCheck,
  LayoutGrid,
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

import { runService } from "@/services/runService";
import { parseWorkflowRunInput, type WorkflowRunInputMode } from "@/lib/workflowRunInput";

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
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
        disabled
          ? "cursor-not-allowed opacity-35"
          : "cursor-pointer hover:bg-zinc-800 hover:text-zinc-100"
      )}
    >
      {children}
    </button>
  );
}

export function EditorToolbar({ session }: { session: Pick<LiveCanvasController, "mode" | "enterLive" | "exitLive"> }) {
  const live = session.mode === "live";
  const [runInput, setRunInput] = React.useState("");
  const [inputMode, setInputMode] = React.useState<WorkflowRunInputMode>("text");
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [isStarting, setIsStarting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputErrorId = React.useId();
  const loadState = useWorkflowStore(s => s.loadState);
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
  const autoArrangeNodes = useWorkflowStore((s) => s.autoArrangeNodes);
  const nodeCount = useWorkflowStore((s) => s.definition.nodes.length);

  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
  const isSaving = saveState === "saving";
  const hasErrors = issues.some((issue) => issue.severity === "error");

  return (
    <div className="flex min-h-11 flex-shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/80 px-3 py-1.5">
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <input
          type="text"
          aria-label="Workflow name"
          value={name}
          disabled={live}
          onChange={(event) => setWorkflowName(event.target.value)}
          placeholder="Workflow name"
          className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs font-semibold text-zinc-100 placeholder-zinc-500 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:w-48 sm:flex-initial"
        />
        {isDirty ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
            Unsaved
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Saved
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800/90 bg-zinc-900/60 p-0.5">
          <ToolButton title="Undo (Ctrl+Z)" disabled={live || !canUndo} onClick={undo}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
          <ToolButton title="Redo (Ctrl+Shift+Z)" disabled={live || !canRedo} onClick={redo}>
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
          <ToolButton
            title="Delete selected nodes/edges (Del)"
            disabled={live || !hasSelection}
            onClick={() => removeSelection(selectedNodeIds, selectedEdgeIds)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800/90 bg-zinc-900/60 p-0.5">
          <ToolButton title="Zoom out" onClick={() => zoomOut()}>
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
          <ToolButton title="Zoom in" onClick={() => zoomIn()}>
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
          <ToolButton title="Fit view" onClick={() => fitView({ duration: 300 })}>
            <Maximize className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
          <ToolButton
            title="Auto-Arrange"
            disabled={live || nodeCount === 0}
            onClick={() => autoArrangeNodes()}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
          </ToolButton>
        </div>

        <span
          role="status"
          className="rounded-md border border-indigo-500/25 bg-indigo-500/10 px-2 py-1 text-[11px] font-semibold text-indigo-300"
        >
          {live ? "Live · Read only" : "Design"}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
        {live && <Button size="sm" variant="outline" onClick={session.exitLive}>Exit Live</Button>}
        <Button
          variant="outline"
          disabled={live}
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
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Validate
        </Button>
        <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
          <select
            aria-label="Run input format"
            value={inputMode}
            onChange={(event) => { setInputMode(event.target.value as WorkflowRunInputMode); setInputError(null); }}
            className="h-8 shrink-0 cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <option value="text">Text</option>
            <option value="json">JSON object</option>
          </select>
          <div className="relative min-w-0 flex-1 sm:flex-initial">
            <input
              ref={inputRef}
              aria-label="Run input"
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? inputErrorId : undefined}
              type="text"
              value={runInput}
              onChange={(event) => { setRunInput(event.target.value); setInputError(null); }}
              onBlur={() => {
                if (inputMode !== "json") return;
                try { parseWorkflowRunInput(runInput, inputMode); setInputError(null); }
                catch (error) { setInputError((error as Error).message); }
              }}
              placeholder={inputMode === "json" ? '{"delivery_request": "..."}' : "Run input"}
              className="h-8 w-full min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder-zinc-500 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:w-40"
            />
            {inputError && <p id={inputErrorId} role="alert" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-red-800 bg-zinc-950 p-2 text-xs text-red-300 shadow-lg">{inputError}</p>}
          </div>
        </div>
        <Button
          size="sm"
          title={hasErrors ? "Resolve validation errors before running" : live ? "Start a new run and replace Live observation" : "Run workflow"}
          disabled={loadState !== "ready" || hasErrors || isStarting}
          onClick={async () => {
            if (live) {
              const confirmed = window.confirm(
                "Start a new run and replace the live observation on this canvas?\n\nThe previous run keeps executing server-side and remains available from its run page or deep link.",
              );
              if (!confirmed) return;
            }
            let input: Record<string, unknown>;
            try { input = parseWorkflowRunInput(runInput, inputMode); setInputError(null); }
            catch (error) { setInputError((error as Error).message); inputRef.current?.focus(); return; }
            setIsStarting(true);
            try {
              const { runId } = await runService.startRun(definition, agents, input, undefined, tools);
              try { sessionStorage.setItem(`run-definition:${runId}`, JSON.stringify(definition)); } catch { /* Server snapshot remains available when browser storage is full. */ }
              await session.enterLive(runId, definition);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : String(error));
            } finally {
              setIsStarting(false);
            }
          }}
          className="h-8 cursor-pointer gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {isStarting ? "Starting…" : live ? "New Run" : "Run"}
        </Button>
        <Button
          size="sm"
          onClick={() => saveWorkflow()}
          disabled={live || isSaving}
          className="h-8 cursor-pointer gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
        >
          <Save className={cn("h-3.5 w-3.5", isSaving && "animate-pulse")} aria-hidden="true" />
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
