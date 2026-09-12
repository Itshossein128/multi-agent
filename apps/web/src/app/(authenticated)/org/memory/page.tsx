"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Memory, MemoryKind, MemoryNamespace } from "@multi-agent/types";
import { memoryService } from "@/services/memoryService";
import { Button } from "@/components/ui/button";
import { Field, fieldClass, Section } from "@/components/agents/AgentFields";
import { formatDateTime } from "@/lib/formatDateTime";

const TOKEN_KEY = "agent-studio.memory-token.v1";
const SCOPES: MemoryNamespace["scope"][] = ["agent", "workflow", "project", "organization", "user"];
const KINDS: MemoryKind[] = ["semantic", "episodic", "procedural"];

function readToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export default function MemoryExplorer() {
  const [token, setToken] = useState("");
  const [scope, setScope] = useState<MemoryNamespace["scope"]>("agent");
  const [namespaceId, setNamespaceId] = useState("");
  const [kind, setKind] = useState<MemoryKind | "">("");
  const [searchText, setSearchText] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setToken(readToken()); setLoaded(true); }, []);
  useEffect(() => { if (loaded) window.localStorage.setItem(TOKEN_KEY, token); }, [token, loaded]);

  const namespace: MemoryNamespace | null = namespaceId.trim() ? { scope, id: namespaceId.trim() } : null;

  const run = async (action: () => Promise<Memory[]>) => {
    if (!token.trim()) { setError("A bearer token is required. It is provisioned server-side via MEMORY_PRINCIPALS."); return; }
    if (!namespace) { setError("A namespace ID is required."); return; }
    setBusy(true); setError(""); setExpandedId(null);
    try { setMemories(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setMemories([]); }
    finally { setBusy(false); }
  };

  const list = () => run(() => memoryService.listMemories(token, namespace!, { kind: kind || undefined, limit: 50 }));
  const search = () => run(async () => {
    if (!searchText.trim()) throw new Error("Enter search text.");
    const result = await memoryService.searchMemories(token, namespace!, searchText.trim(), kind ? [kind] : undefined);
    return result.results.map((item) => item.memory);
  });

  const remove = async (id: string) => {
    if (!window.confirm("Delete this memory? This cannot be undone.")) return;
    try { await memoryService.deleteMemory(token, id); setMemories((current) => current.filter((memory) => memory.id !== id)); if (expandedId === id) setExpandedId(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <main className="min-h-screen space-y-6 bg-zinc-950 p-6 text-zinc-100">
    <Link className="text-indigo-300 underline" href="/org">Back to Graph Editor</Link>
    <h1 className="text-2xl font-semibold">Memory explorer</h1>
    <p className="text-zinc-400">Inspects and manages long-term backend memory. Requires a server-provisioned bearer token (MEMORY_PRINCIPALS) with read/delete grants for the namespace you query.</p>

    <Section title="Access and scope">
      <Field label="Bearer token"><input type="password" autoComplete="off" className={fieldClass} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Provisioned via MEMORY_PRINCIPALS" /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Namespace scope"><select className={fieldClass} value={scope} onChange={(event) => setScope(event.target.value as MemoryNamespace["scope"])}>{SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
        <Field label="Namespace ID"><input className={fieldClass} value={namespaceId} onChange={(event) => setNamespaceId(event.target.value)} placeholder="agent-id, workflow-id, …" /></Field>
        <Field label="Kind filter"><select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value as MemoryKind | "")}><option value="">All kinds</option>{KINDS.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1"><Field label="Search text (relevance-scored recall)"><input className={fieldClass} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Optional — leave blank and use List instead" /></Field></div>
        <Button disabled={busy} onClick={() => void list()}>List recent</Button>
        <Button variant="outline" disabled={busy} onClick={() => void search()}>Search</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </Section>

    <Section title={`Results (${memories.length})`}>
      {busy && <p role="status" className="text-sm text-zinc-400">Loading…</p>}
      {!busy && !memories.length && <p className="text-sm text-zinc-400">No memories loaded yet. Set a namespace above and choose List or Search.</p>}
      <ul className="space-y-2">{memories.map((memory) => <li key={memory.id} className="rounded-lg border border-zinc-800 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpandedId(expandedId === memory.id ? null : memory.id)}>
            <p className="break-words text-sm font-medium">{memory.subject || memory.title || memory.content.slice(0, 80)}</p>
            <p className="mt-1 text-xs text-zinc-400">{memory.kind} · {memory.status} · importance {memory.importance} · created {formatDateTime(memory.createdAt)}</p>
            <p className="text-xs text-zinc-500">Source: {memory.source.type}{memory.source.agentId ? ` · agent ${memory.source.agentId}` : ""}{memory.source.runId ? ` · run ${memory.source.runId}` : ""}{memory.source.workflowId ? ` · workflow ${memory.source.workflowId}` : ""}</p>
          </button>
          <Button variant="destructive" size="sm" onClick={() => void remove(memory.id)}>Delete</Button>
        </div>
        {expandedId === memory.id && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-3 text-xs text-zinc-300">{JSON.stringify(memory, null, 2)}</pre>}
      </li>)}</ul>
    </Section>
  </main>;
}
