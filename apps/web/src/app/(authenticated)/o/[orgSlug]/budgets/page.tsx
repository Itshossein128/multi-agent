"use client";

import { scopedApiPath } from "@/lib/orgRoute";
import { PageContainer } from "@/components/layout/PageContainer";
import { AlertCircle, Bell, Wallet } from "lucide-react";

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
    const response = await fetch(scopedApiPath("/api/execution/studio/budgets"));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load budgets");
    setData(body);
  }, []);
  useEffect(() => {
    void reload().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load budgets"));
    void Promise.all([fetch(scopedApiPath("/api/execution/studio/agents")), fetch(scopedApiPath("/api/execution/studio/projects"))]).then(async ([a,p]) => {
      const [agentRows, projectRows] = await Promise.all([a.json(), p.json()]);
      setAgents(Array.isArray(agentRows) ? agentRows : []); setProjects(Array.isArray(projectRows) ? projectRows : []);
    }).catch(() => {});
  }, [reload]);
  const configure = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(scopedApiPath("/api/execution/studio/budgets"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, scopeId: scope === "company" ? undefined : scopeId, limitUsd: Number(limitUsd), thresholdPercent: Number(thresholdPercent) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save budget");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save budget"); }
    finally { setBusy(false); }
  };
  const label = (budget: Pick<Budget, "scope" | "scopeId">) => budget.scope === "company" ? "Company" : budget.scope === "agent" ? agents.find(a => a.id === budget.scopeId)?.name ?? budget.scopeId : projects.find(p => p.id === budget.scopeId)?.name ?? budget.scopeId;
  return (
    <PageContainer className="space-y-6">
      <header className="flex items-center gap-3 border-b border-zinc-800 pb-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
          <Wallet className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Cost budgets</h1>
          <p className="text-xs text-zinc-400">
            Set monthly company, agent, and project caps. Each agent invocation reserves an estimated amount before execution.
          </p>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-300"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={configure}
        className="grid items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-5"
      >
        <label className="block space-y-1.5 text-xs font-medium text-zinc-400">
          <span>Scope</span>
          <select
            aria-label="Budget scope"
            value={scope}
            onChange={event => { setScope(event.target.value as Budget["scope"]); setScopeId(""); }}
            className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <option value="company">Company</option>
            <option value="agent">Agent</option>
            <option value="project">Project</option>
          </select>
        </label>

        <label className="block space-y-1.5 text-xs font-medium text-zinc-400">
          <span>Target</span>
          <select
            aria-label="Budget target"
            value={scopeId}
            onChange={event => setScopeId(event.target.value)}
            disabled={scope === "company"}
            required={scope !== "company"}
            className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <option value="">{scope === "company" ? "Whole company" : "Select target"}</option>
            {(scope === "agent" ? agents : scope === "project" ? projects : []).map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-xs font-medium text-zinc-400">
          <span>Monthly USD</span>
          <input
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            value={limitUsd}
            onChange={event => setLimitUsd(event.target.value)}
            className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </label>

        <label className="block space-y-1.5 text-xs font-medium text-zinc-400">
          <span>Alert at %</span>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={thresholdPercent}
            onChange={event => setThresholdPercent(event.target.value)}
            className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Saving…" : "Save budget"}
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">Current period</h2>
        {data.budgets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-8 text-center">
            <Wallet className="mx-auto mb-2 h-6 w-6 text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">No budgets configured.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Configure a monthly cap above to track spend and receive threshold alerts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.budgets.map(budget => {
              const pct = Math.min(100, ((budget.spentUsd + budget.reservedUsd) / budget.limitUsd) * 100);
              const barColor =
                pct >= 100
                  ? "bg-red-500"
                  : pct >= budget.thresholdPercent
                    ? "bg-amber-500"
                    : "bg-indigo-500";
              return (
                <article
                  key={`${budget.scope}:${budget.scopeId}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <strong className="font-semibold text-zinc-100">{label(budget)}</strong>
                    <span className="text-xs font-medium text-zinc-300">
                      ${budget.spentUsd.toFixed(2)} spent · ${budget.reservedUsd.toFixed(2)} reserved / ${budget.limitUsd.toFixed(2)}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${label(budget)} budget utilization`}
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 overflow-hidden rounded-full bg-zinc-800"
                  >
                    <div
                      className={`h-2 rounded-full transition-all ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400">
                    Alert at {budget.thresholdPercent}% · Renews {new Date(budget.periodEnd).toLocaleDateString()}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">Alerts</h2>
        {data.alerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-6 text-center">
            <Bell className="mx-auto mb-1.5 h-5 w-5 text-zinc-500" aria-hidden="true" />
            <p className="text-sm text-zinc-400">No alerts.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800">
            {data.alerts.map((alert, index) => (
              <p key={`${alert.scope}:${alert.scopeId}:${index}`} className="px-4 py-3 text-sm text-zinc-200">
                {label(alert)} reached {alert.level === "limit" ? "the limit" : "the alert threshold"} · ${alert.spentUsd.toFixed(2)} of ${alert.limitUsd.toFixed(2)} · {new Date(alert.createdAt).toLocaleString()}
              </p>
            ))}
          </div>
        )}
      </section>
    </PageContainer>
  );
}
