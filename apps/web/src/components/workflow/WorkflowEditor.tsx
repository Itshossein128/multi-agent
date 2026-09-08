"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { EditorToolbar } from "@/components/workflow/EditorToolbar";
import { NodePalette } from "@/components/workflow/NodePalette";
import { FlowCanvas } from "@/components/workflow/FlowCanvas";
import { PropertiesPanel } from "@/components/workflow/PropertiesPanel";
import { StatusBar } from "@/components/workflow/StatusBar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";
import { WorkflowSwitcher } from "./WorkflowSwitcher";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-400">
      <span className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
        Loading workflow…
      </span>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/40">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-medium text-zinc-200">Could not load the workflow</p>
          <p className="text-xs text-zinc-500">{message}</p>
          <Button size="sm" onClick={onRetry} className="cursor-pointer">
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function WorkflowEditor() {
  return <Suspense fallback={<LoadingState />}><WorkflowEditorContent /></Suspense>;
}

function WorkflowEditorContent() {
  const searchParams = useSearchParams();
  const requestedWorkflowId = searchParams.get("workflowId") ?? undefined;
  const requestedNodeId = searchParams.get("focusNode");
  const [focusError, setFocusError] = useState<string | null>(null);
  const focused = useRef(false);
  const definition = useWorkflowStore((s) => s.definition);
  const flowHelpers = useWorkflowStore((s) => s.flowHelpers);
  const loadState = useWorkflowStore((s) => s.loadState);
  const loadError = useWorkflowStore((s) => s.loadError);
  const saveError = useWorkflowStore((s) => s.saveError);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);

  // Initial load
  useEffect(() => {
    focused.current = false;
    void loadWorkflow(requestedWorkflowId);
  }, [loadWorkflow, requestedWorkflowId]);

  useEffect(() => {
    if (loadState !== "ready" || !flowHelpers || focused.current) return;
    const nodeId = requestedNodeId;
    if (!nodeId) return;
    // Wait for the canvas layout before centering and reporting navigation results.
    const frame = requestAnimationFrame(() => {
      focused.current = true;
      const workflowId = requestedWorkflowId;
      if (workflowId && workflowId !== definition.id) { setFocusError("The requested workflow is not available in this browser’s saved workspace."); return; }
      const node = definition.nodes.find((item) => item.id === nodeId);
      if (!node) { setFocusError("The requested node no longer exists in this workflow."); return; }
      useWorkflowStore.getState().selectNodeOnly(node.id);
      flowHelpers.setCenter(node.position.x + 112, node.position.y + 40, 1.1);
    });
    return () => cancelAnimationFrame(frame);
  }, [loadState, flowHelpers, definition, requestedNodeId, requestedWorkflowId]);

  // Global keyboard shortcuts (Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Shift+Z redo)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveWorkflow();
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveWorkflow, undo, redo, clearSelection]);

  return (
    <ReactFlowProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <WorkflowSwitcher />
        <EditorToolbar />
        {saveError && <p role="alert" className="bg-red-950 p-3 text-sm text-red-200">{saveError}</p>}
        {focusError && <p role="status" className="bg-amber-950 p-3 text-sm text-amber-200">{focusError}</p>}

        {loadState === "loading" && <LoadingState />}
        {loadState === "error" && (
          <ErrorState message={loadError ?? "Unknown error"} onRetry={() => void loadWorkflow(requestedWorkflowId)} />
        )}

        {loadState === "ready" && (
          <>
            <div className="flex min-h-0 flex-1">
              <NodePalette />
              <main className="relative min-w-0 flex-1">
                <FlowCanvas />
              </main>
              <PropertiesPanel />
            </div>
            <StatusBar />
          </>
        )}
      </div>
    </ReactFlowProvider>
  );
}
