"use client";

import { useOrg, useOrgPath } from "@/components/organization/OrgProvider";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Brain, ChevronDown, ChevronRight, Search, Trash2 } from "lucide-react";
import type { Memory, MemoryKind, MemoryNamespace } from "@multi-agent/types";
import { PageContainer } from "@/components/layout/PageContainer";
import { memoryService, type MemoryAuthContext } from "@/services/memoryService";
import { Button } from "@/components/ui/button";
import { Field, fieldClass, Section } from "@/components/agents/AgentFields";
import { formatDateTime } from "@/lib/formatDateTime";

const TOKEN_KEY = "agent-studio.memory-token.v1";
const ALL_SCOPES: MemoryNamespace["scope"][] = ["organization", "agent", "workflow", "project", "user"];
const KINDS: MemoryKind[] = ["semantic", "episodic", "procedural"];

function readToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export default function MemoryExplorer() {
  const orgUrl = useOrgPath();
  const { org } = useOrg();
  const orgMemoryScopeEnabled =
    process.env.NEXT_PUBLIC_ORG_MEMORY_SCOPE !== "false" &&
    process.env.NEXT_PUBLIC_ORG_MEMORY_SCOPE !== "0";

  const availableScopes = orgMemoryScopeEnabled
    ? ALL_SCOPES
    : ALL_SCOPES.filter((s) => s !== "organization");

  const [token, setToken] = useState("");
  const [scope, setScope] = useState<MemoryNamespace["scope"]>(
    orgMemoryScopeEnabled ? "organization" : "agent",
  );
  const [namespaceId, setNamespaceId] = useState(
    orgMemoryScopeEnabled ? org.id : "",
  );
  const [kind, setKind] = useState<MemoryKind | "">("");
  const [searchText, setSearchText] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setToken(readToken());
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loaded && token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else if (loaded && !token) {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  }, [token, loaded]);

  useEffect(() => {
    setMemories([]);
    setError("");
    setExpandedId(null);
    if (scope === "organization") {
      setNamespaceId(org.id);
    }
  }, [org.id, scope]);

  useEffect(() => {
    if (!loaded || scope !== "organization" || !org.id) return;
    let active = true;
    const auth: MemoryAuthContext = token.trim() ? token.trim() : { orgSlug: org.slug };
    setBusy(true);
    setError("");
    memoryService
      .listMemories(auth, { scope: "organization", id: org.id }, { kind: kind || undefined, limit: 50 })
      .then((items) => {
        if (active) setMemories(items);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setMemories([]);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [loaded, scope, org.id, org.slug, token, kind]);

  const canDelete =
    scope === "organization"
      ? org.role === "owner" || org.role === "admin"
      : true;

  const authContext: MemoryAuthContext = token.trim()
    ? token.trim()
    : { orgSlug: org.slug };

  const activeNamespaceId = scope === "organization" ? org.id : namespaceId.trim();
  const namespace: MemoryNamespace | null = activeNamespaceId
    ? { scope, id: activeNamespaceId }
    : null;

  const run = async (action: () => Promise<Memory[]>) => {
    if (!namespace) {
      setError("A namespace ID is required.");
      return;
    }
    setBusy(true);
    setError("");
    setExpandedId(null);
    try {
      setMemories(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMemories([]);
    } finally {
      setBusy(false);
    }
  };

  const list = () =>
    run(() =>
      memoryService.listMemories(authContext, namespace!, {
        kind: kind || undefined,
        limit: 50,
      }),
    );

  const search = () =>
    run(async () => {
      if (!searchText.trim()) throw new Error("Enter search text.");
      const result = await memoryService.searchMemories(
        authContext,
        namespace!,
        searchText.trim(),
        kind ? [kind] : undefined,
      );
      return result.results.map((item) => item.memory);
    });

  const remove = async (id: string) => {
    if (scope === "organization" && !canDelete) {
      setError("Deleting organization memory requires an owner or admin role.");
      return;
    }
    if (!window.confirm("Delete this memory? This cannot be undone.")) return;
    try {
      await memoryService.deleteMemory(authContext, id);
      setMemories((current) => current.filter((memory) => memory.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <PageContainer>
      {/* Top Breadcrumb Navigation */}
      <nav aria-label="Breadcrumbs" className="breadcrumb flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <ol className="flex flex-wrap items-center">
          <li>
            <Link
              className="inline-flex min-h-7 items-center rounded px-1 text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              href={orgUrl("/org")}
            >
              Graph Editor
            </Link>
          </li>
          <li>
            <Link
              href={orgUrl("/org/memory")}
              aria-current="page"
              className="inline-flex min-h-7 items-center rounded px-1 font-medium text-zinc-200 hover:underline"
            >
              Memory explorer
            </Link>
          </li>
        </ol>
        <Link
          className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-xs text-indigo-300 transition-colors hover:bg-zinc-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          href={orgUrl("/org")}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Graph Editor</span>
        </Link>
      </nav>

      {/* Page Header */}
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-500/10 text-purple-400">
          <Brain className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Memory explorer</h1>
          <p className="text-xs text-zinc-400">
            Inspects and manages long-term backend memory. Access is authenticated via organization membership with role-based read/delete permissions.
          </p>
        </div>
      </div>

      {!orgMemoryScopeEnabled && (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3.5 text-xs text-amber-300">
          Organization memory scope is disabled by configuration (ORG_MEMORY_SCOPE=false).
          Namespace scopes are restricted to agent, workflow, project, and user.
        </div>
      )}

      <Section title="Access and scope">
        <Field label="Bearer token (optional manual override)">
          <input
            type="password"
            autoComplete="off"
            className={fieldClass}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Leave blank to use organization session credentials"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Namespace scope">
            <select
              className={`studio-select ${fieldClass}`}
              value={scope}
              onChange={(event) => {
                const newScope = event.target.value as MemoryNamespace["scope"];
                setScope(newScope);
                if (newScope === "organization") {
                  setNamespaceId(org.id);
                }
              }}
            >
              {availableScopes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Namespace ID">
            <input
              className={fieldClass}
              value={scope === "organization" ? org.id : namespaceId}
              disabled={scope === "organization"}
              onChange={(event) => setNamespaceId(event.target.value)}
              placeholder={scope === "organization" ? org.id : "agent-id, workflow-id, …"}
            />
          </Field>
          <Field label="Kind filter">
            <select
              className={`studio-select ${fieldClass}`}
              value={kind}
              onChange={(event) => setKind(event.target.value as MemoryKind | "")}
            >
              <option value="">All kinds</option>
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Field label="Search text (relevance-scored recall)">
              <input
                className={fieldClass}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Optional — leave blank and use List instead"
              />
            </Field>
          </div>
          <Button disabled={busy} onClick={() => void list()}>
            List recent
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void search()} className="gap-1.5">
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            Search
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </Section>

      <Section title={`Results (${memories.length})`}>
        {busy && <p role="status" className="text-sm text-zinc-400">Loading…</p>}
        {!busy && !memories.length && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 px-6 py-10 text-center space-y-2">
            <Brain className="mx-auto h-7 w-7 text-zinc-500" aria-hidden="true" />
            <p className="text-sm text-zinc-400">
              No memories loaded yet. Set a namespace above and choose List or Search.
            </p>
          </div>
        )}
        <ul className="space-y-2.5">
          {memories.map((memory) => {
            const isExpanded = expandedId === memory.id;
            return (
              <li key={memory.id} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3.5 transition-colors hover:border-zinc-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    className="min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                    onClick={() => setExpandedId(isExpanded ? null : memory.id)}
                  >
                    <div className="flex items-start gap-2">
                      {isExpanded ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="break-words text-sm font-medium text-zinc-100">
                          {memory.subject || memory.title || memory.content.slice(0, 80)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                          <span className="rounded-full border border-purple-500/30 bg-purple-950/30 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                            {memory.kind}
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                            {memory.status}
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            importance {memory.importance} · created {formatDateTime(memory.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500">
                          Source: {memory.source.type}
                          {memory.source.agentId ? ` · agent ${memory.source.agentId}` : ""}
                          {memory.source.runId ? ` · run ${memory.source.runId}` : ""}
                          {memory.source.workflowId ? ` · workflow ${memory.source.workflowId}` : ""}
                        </p>
                      </div>
                    </div>
                  </button>
                  {canDelete ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void remove(memory.id)}
                      className="gap-1.5 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : (
                    <span
                      className="text-xs text-zinc-500 italic self-center"
                      title="Requires owner or admin role to delete organization memory"
                    >
                      Read-only
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 font-mono text-xs text-zinc-300">
                    {JSON.stringify(memory, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </PageContainer>
  );
}
