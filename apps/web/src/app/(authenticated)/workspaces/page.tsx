"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface EntityRow {
  id: string;
  name: string;
  description: string;
  status: string;
  updatedAt: string;
}

export default function WorkspacesPage() {
  const [items, setItems] = useState<EntityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load workspaces");
      setItems(body);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Create failed");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string) {
    if (!window.confirm("Retire this workspace? It will leave the active list and cannot receive new tasks.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retire", id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Retire failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retire failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rename failed");
      setRenamingId(null);
      setRenameValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Workspaces</h1>
        <p className="text-sm text-zinc-400">Browse workspaces and open a dashboard for related tasks and projects.</p>
      </div>

      <form onSubmit={createWorkspace} className="flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[12rem] space-y-1 text-xs text-zinc-400">
          New workspace name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            placeholder="e.g. Lab environment"
          />
        </label>
        <Button type="submit" disabled={busy || !name.trim()} size="sm">Create</Button>
      </form>

      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Retry</Button>
        </div>
      )}
      {loading && <p className="text-sm text-zinc-400">Loading workspaces…</p>}

      {!loading && loaded && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center space-y-2">
          <p className="text-sm text-zinc-300">No active workspaces yet.</p>
          <p className="text-xs text-zinc-500">Create one above to assign tasks to an execution boundary.</p>
        </div>
      )}

      {loaded && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
              <div className="min-w-0 flex-1">
                {renamingId === item.id ? (
                  <form
                    className="flex flex-wrap gap-2 items-center"
                    onSubmit={(e) => { e.preventDefault(); void saveRename(item.id); }}
                  >
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 min-w-[10rem] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={busy || !renameValue.trim()}>Save</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingId(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <Link href={`/workspaces/${encodeURIComponent(item.id)}`} className="font-medium text-indigo-300 hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-xs text-zinc-500 break-all">{item.id}</p>
                    {item.description ? <p className="text-xs text-zinc-400 mt-1">{item.description}</p> : null}
                  </>
                )}
              </div>
              {renamingId !== item.id && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => { setRenamingId(item.id); setRenameValue(item.name); }}
                  >
                    Rename
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void retire(item.id)}>Retire</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
