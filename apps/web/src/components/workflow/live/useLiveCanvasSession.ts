"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkflowDefinition } from "@multi-agent/types";
import { useRunStore } from "@/store/useRunStore";
import { runService } from "@/services/runService";
import type { LiveCanvasController, StudioLiveQuery } from "./liveCanvas.types";
export function modeFromQuery(query: StudioLiveQuery) { return query.runId ? "live" : "design"; }
export function buildStudioQuery(query: StudioLiveQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value)
      params.set(key, value);
  return params;
}
export function useLiveCanvasSession(): LiveCanvasController & {
  error: string | null;
} {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const searchQuery = search.toString();
  const query = useRef(searchQuery);
  useEffect(() => { query.current = searchQuery; }, [searchQuery]);
  const [attachedRunId, setAttachedRunId] = useState<string | null>(search.get("runId"));
  const [liveDefinition, setLiveDefinition] = useState<WorkflowDefinition | null>(null);
  const [selectedInspectNodeId, selectInspectNode] = useState<string | null>(search.get("focusNode"));
  const [error, setError] = useState<string | null>(null);
  const close = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const activeRun = useRef<string | null>(null);
  const syncUrl = useCallback((runId?: string, workflowId?: string) => {
    const params = new URLSearchParams(query.current);
    if (runId)
      params.set("runId", runId);
    else
      params.delete("runId");
    if (workflowId)
      params.set("workflowId", workflowId);
    query.current = params.toString();
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }, [router, pathname]);
  const attachRun = useCallback(async (runId: string, workflowId?: string, snapshot?: WorkflowDefinition) => {
    if (activeRun.current === runId)
      return;
    activeRun.current = runId;
    const ticket = ++generation.current;
    close.current?.();
    close.current = null;
    useRunStore.getState().clear();
    setAttachedRunId(runId);
    setLiveDefinition(snapshot ?? null);
    setError(null);
    selectInspectNode(null);
    syncUrl(runId, workflowId ?? snapshot?.id);
    const loading = useRunStore.getState().load(runId);
    close.current = useRunStore.getState().attach(runId);
    await loading;
    if (ticket !== generation.current)
      return;
    if (useRunStore.getState().error) {
      setError(useRunStore.getState().error);
      return;
    }
    let resolved: WorkflowDefinition | null = snapshot ?? null;
    try {
      const result = await runService.getRunDefinition(runId);
      if (ticket === generation.current) {
        resolved = result.workflow;
        setLiveDefinition(result.workflow);
      }
    }
    catch {
      if (ticket !== generation.current)
        return;
      try {
        const stored = sessionStorage.getItem(`run-definition:${runId}`);
        const fallback = stored ? JSON.parse(stored) as WorkflowDefinition : snapshot;
        if (fallback && Array.isArray(fallback.nodes) && Array.isArray(fallback.edges)) {
          resolved = fallback;
          setLiveDefinition(fallback);
        }
      }
      catch { /* Storage can be unavailable or contain an invalid older snapshot. */ }
    }
    if (ticket === generation.current && !resolved) {
      setError("Run graph unavailable. The execution snapshot could not be loaded.");
    }
  }, [syncUrl]);
  const enterLive = useCallback((runId: string, snapshot?: WorkflowDefinition) => attachRun(runId, snapshot?.id, snapshot), [attachRun]);
  const attachExistingRun = useCallback((runId: string, workflowId?: string) => attachRun(runId, workflowId), [attachRun]);
  const exitLive = useCallback(() => {
    ++generation.current;
    activeRun.current = null;
    close.current?.();
    close.current = null;
    useRunStore.getState().clear();
    setAttachedRunId(null);
    setLiveDefinition(null);
    selectInspectNode(null);
    setError(null);
    syncUrl();
  }, [syncUrl]);
  useEffect(() => () => { ++generation.current; activeRun.current = null; close.current?.(); useRunStore.getState().clear(); }, []);
  return { mode: attachedRunId ? "live" : "design", attachedRunId, liveDefinition, selectedInspectNodeId, enterLive, exitLive, attachExistingRun, selectInspectNode, error };
}
