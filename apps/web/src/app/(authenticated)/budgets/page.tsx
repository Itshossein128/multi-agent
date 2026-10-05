"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Budget { tenantId: string; scope: "company" | "agent" | "project"; scopeId: string; limitUsd: number; thresholdPercent: number; spentUsd: number; reservedUsd: number; periodStart: string; periodEnd: string }
interface Alert { scope: Budget["scope"]; scopeId: string; level: "threshold" | "limit"; createdAt: string; spentUsd: number; limitUsd: number }
interface BudgetData { budgets: Budget[]; alerts: Alert[] }

export default function BudgetsPage() {
  const [data, setData] = useState<BudgetData>({ budgets: [], alerts: [] });
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [scope, setScope] = useState<Budget["scope"]>("company");
  const [scopeId, setScopeId] = useState("");
  const [limitUsd, setLimitUsd] = useState("25");
  const [thresholdPercent, setThresholdPercent] = useState("80");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const response = await fetch("/api/execution/studio/budgets");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load budgets");
    setData(body);
  }, []);
  useEffect(() => {
    void reload().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load budgets"));
    void Promise.all([fetch("/api/execution/studio/agents"), fetch("/api/execution/studio/projects")]).then(async ([a,p]) => {
      const [agentRows, projectRows] = await Promise.all([a.json(), p.json()]);
      setAgents(Array.isArray(agentRows) ? agentRows : []); setProjects(Array.isArray(projectRows) ? projectRows : []);
    }).catch(() => {});
  }, [reload]);
  const configure = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/execution/studio/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, scopeId: scope === "company" ? undefined : scopeId, limitUsd: Number(limitUsd), thresholdPercent: Number(thresholdPercent) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save budget");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save budget"); }
    finally { setBusy(false); }
  };
  const label = (budget: Pick<Budget, "scope" | "scopeId">) => budget.scope === "company" ? "Company" : budget.scope === "agent" ? agents.find(a => a.id === budget.scopeId)?.name ?? budget.scopeId : projects.find(p => p.id === budget.scopeId)?.name ?? budget.scopeId;
  return <main className="mx-auto max-w-5xl space-y-8 p-6 text-zinc-100"><header><h1 className="text-2xl font-semibold">Cost budgets</h1><p className="text-sm text-zinc-400">Set monthly company, agent, and project caps. Each agent invocation reserves an estimated amount before execution.</p></header>
    {error && <p role="alert" className="rounded border border-rose-700 bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}
    <form onSubmit={configure} className="grid gap-3 rounded-lg border border-zinc-800 p-4 md:grid-cols-5">
      <select aria-label="Budget scope" value={scope} onChange={event => { setScope(event.target.value as Budget["scope"]); setScopeId(""); }} className="rounded bg-zinc-900 p-2"><option value="company">Company</option><option value="agent">Agent</option><option value="project">Project</option></select>
      <select aria-label="Budget target" value={scopeId} onChange={event => setScopeId(event.target.value)} disabled={scope === "company"} required={scope !== "company"} className="rounded bg-zinc-900 p-2 disabled:opacity-50"><option value="">{scope === "company" ? "Whole company" : "Select target"}</option>{(scope === "agent" ? agents : scope === "project" ? projects : []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className="text-xs text-zinc-400">Monthly USD<input type="number" min="0.01" max="1000000" step="0.01" value={limitUsd} onChange={event => setLimitUsd(event.target.value)} className="mt-1 w-full rounded bg-zinc-900 p-2 text-sm text-zinc-100" /></label>
      <label className="text-xs text-zinc-400">Alert at %<input type="number" min="1" max="100" step="1" value={thresholdPercent} onChange={event => setThresholdPercent(event.target.value)} className="mt-1 w-full rounded bg-zinc-900 p-2 text-sm text-zinc-100" /></label>
      <button disabled={busy} className="rounded bg-indigo-600 px-3 py-2 text-sm disabled:opacity-50">Save budget</button>
    </form>
    <section className="space-y-3"><h2 className="text-lg font-medium">Current period</h2>{data.budgets.length === 0 && <p className="text-sm text-zinc-400">No budgets configured.</p>}{data.budgets.map(budget => <article key={`${budget.scope}:${budget.scopeId}`} className="rounded border border-zinc-800 p-4"><div className="flex justify-between"><strong>{label(budget)}</strong><span>${budget.spentUsd.toFixed(2)} spent · ${budget.reservedUsd.toFixed(2)} reserved / ${budget.limitUsd.toFixed(2)}</span></div><div className="mt-2 h-2 rounded bg-zinc-800"><div className="h-2 rounded bg-indigo-500" style={{ width: `${Math.min(100, (budget.spentUsd + budget.reservedUsd) / budget.limitUsd * 100)}%` }} /></div><p className="mt-2 text-xs text-zinc-400">Alert at {budget.thresholdPercent}% · Renews {new Date(budget.periodEnd).toLocaleDateString()}</p></article>)}</section>
    <section><h2 className="mb-3 text-lg font-medium">Alerts</h2>{data.alerts.length === 0 && <p className="text-sm text-zinc-400">No alerts.</p>}{data.alerts.map((alert,index) => <p key={`${alert.scope}:${alert.scopeId}:${index}`} className="border-b border-zinc-800 py-2 text-sm">{label(alert)} reached {alert.level === "limit" ? "the limit" : "the alert threshold"} · ${alert.spentUsd.toFixed(2)} of ${alert.limitUsd.toFixed(2)} · {new Date(alert.createdAt).toLocaleString()}</p>)}</section>
  </main>;
}
