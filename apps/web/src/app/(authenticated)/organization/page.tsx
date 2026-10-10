"use client";

import { useCallback, useEffect, useState } from "react";

interface Agent { id: string; name: string }
interface Line { agentId: string; managerAgentId: string | null; role: "ceo" | "manager" | "member" }
interface Goal { id: string; title: string; description: string; status: "proposed" | "active" | "completed" | "cancelled"; parentGoalId: string | null; ownerAgentId: string | null; projectId: string | null }
interface GoalTask { id: string; title: string; status: string; output: string | null; goalId: string; parentTaskId: string | null; strategyProposal: boolean }
interface Overview { agents: Agent[]; reportingLines: Line[]; goals: Goal[]; goalTasks: GoalTask[] }
const base = "/api/execution/studio/organization";

async function request(path: string, method: string, body?: object) {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}

export default function OrganizationPage() {
  const [data, setData] = useState<Overview>({ agents: [], reportingLines: [], goals: [], goalTasks: [] });
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState("");
  const [parentGoalId, setParentGoalId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [ceoProposal, setCeoProposal] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [delegationProjects, setDelegationProjects] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try { setData(await request("", "GET")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load organization"); }
  }, []);
  useEffect(() => { void reload(); void fetch("/api/execution/studio/projects").then(r => r.json()).then(items => setProjects(Array.isArray(items) ? items : [])).catch(() => {}); }, [reload]);
  const apply = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed"); }
    finally { setBusy(false); }
  };
  const name = (id: string | null) => data.agents.find(agent => agent.id === id)?.name ?? id ?? "Unassigned";
  const strategyReady = (goalId: string) => {
    const proposals = data.goalTasks.filter(task => task.goalId === goalId && task.strategyProposal);
    return proposals.length === 0 || proposals.some(task => ["completed", "done"].includes(task.status) && Boolean(task.output?.trim()));
  };
  return <main className="mx-auto max-w-6xl space-y-8 p-6 text-zinc-100">
    <header><h1 className="text-2xl font-semibold">Organization and goals</h1><p className="text-sm text-zinc-400">Define reporting lines, review strategy proposals, and delegate goals as tasks.</p></header>
    {error && <p role="alert" className="rounded border border-rose-700 bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}
    <section className="rounded-lg border border-zinc-800 p-4"><h2 className="mb-4 text-lg font-medium">Reporting lines</h2>
      <div className="grid gap-3 md:grid-cols-2">{data.agents.map(agent => {
        const line = data.reportingLines.find(item => item.agentId === agent.id);
        return <div key={`${agent.id}:${line?.role ?? ""}:${line?.managerAgentId ?? ""}`} className="rounded border border-zinc-700 p-3"><div className="mb-2 font-medium">{agent.name}</div>
          <div className="flex gap-2"><select aria-label={`${agent.name} role`} defaultValue={line?.role ?? ""} id={`role-${agent.id}`} className="rounded bg-zinc-900 p-2 text-sm"><option value="">Select role</option><option value="ceo">CEO</option><option value="manager">Manager</option><option value="member">Member</option></select>
          <select aria-label={`${agent.name} manager`} defaultValue={line?.managerAgentId ?? ""} id={`manager-${agent.id}`} className="min-w-0 flex-1 rounded bg-zinc-900 p-2 text-sm"><option value="">No manager</option>{data.agents.filter(other => other.id !== agent.id).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select>
          <button disabled={busy} className="rounded bg-indigo-600 px-3 text-sm disabled:opacity-50" onClick={() => void apply(() => request(`/agents/${encodeURIComponent(agent.id)}`, "PUT", { role: (document.getElementById(`role-${agent.id}`) as HTMLSelectElement).value, managerAgentId: (document.getElementById(`manager-${agent.id}`) as HTMLSelectElement).value || null }))}>Save</button></div>
        </div>;
      })}</div>
    </section>
    <section className="rounded-lg border border-zinc-800 p-4"><h2 className="mb-4 text-lg font-medium">New goal</h2>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={event => { event.preventDefault(); if (ceoProposal && !projectId) return; void apply(async () => { if (ceoProposal) await request("/strategy", "POST", { title, brief: description, projectId }); else await request("/goals", "POST", { title, description, ownerAgentId: ownerAgentId || null, parentGoalId: parentGoalId || null, projectId: projectId || null }); setTitle(""); setDescription(""); }); }}>
        <input required maxLength={200} placeholder="Goal title" aria-label="Goal title" value={title} onChange={event => setTitle(event.target.value)} className="rounded bg-zinc-900 p-2" />
        <input maxLength={4000} required={ceoProposal} placeholder={ceoProposal ? "Strategy brief for CEO agent" : "Description"} aria-label="Goal description" value={description} onChange={event => setDescription(event.target.value)} className="rounded bg-zinc-900 p-2" />
        <select aria-label="Goal owner agent" value={ownerAgentId} onChange={event => setOwnerAgentId(event.target.value)} className="rounded bg-zinc-900 p-2"><option value="">No owner</option>{data.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <select aria-label="Parent goal" value={parentGoalId} onChange={event => setParentGoalId(event.target.value)} className="rounded bg-zinc-900 p-2"><option value="">Company goal</option>{data.goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select>
        <select aria-label="Project" required={ceoProposal} value={projectId} onChange={event => setProjectId(event.target.value)} className="rounded bg-zinc-900 p-2"><option value="" disabled={ceoProposal}>{ceoProposal ? "Select project" : "No project"}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ceoProposal} disabled={!data.reportingLines.some(line => line.role === "ceo")} onChange={event => setCeoProposal(event.target.checked)} />CEO strategy proposal</label>
        {ceoProposal && projects.length === 0 && <p className="text-sm text-zinc-400"><a href="/projects" className="text-indigo-300 underline">Create a project</a> to request a strategy proposal.</p>}
        <button disabled={busy || (ceoProposal && !projectId)} className="rounded bg-indigo-600 p-2 disabled:opacity-50">Create goal</button>
      </form>
    </section>
    <section className="rounded-lg border border-zinc-800 p-4"><h2 className="mb-4 text-lg font-medium">Goal tree</h2>
      {data.goals.length === 0 && <p className="text-sm text-zinc-400">No goals yet.</p>}
      {data.goals.map(goal => <article key={goal.id} className="mb-3 rounded border border-zinc-700 p-3" style={{ marginLeft: goal.parentGoalId ? 20 : 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{goal.title}</strong><span className="ml-2 text-xs text-zinc-400">{goal.status} · {name(goal.ownerAgentId)}</span></div>
          <div className="flex gap-2">{goal.status === "proposed" && <button disabled={busy || !strategyReady(goal.id)} title={!strategyReady(goal.id) ? "The CEO strategy task must finish first" : undefined} className="rounded bg-emerald-700 px-2 py-1 text-xs disabled:opacity-50" onClick={() => void apply(() => request(`/goals/${encodeURIComponent(goal.id)}`, "PATCH", { status: "active" }))}>Approve</button>}
            {goal.status === "active" && <><select aria-label={`Delegate ${goal.title}`} id={`delegate-${goal.id}`} className="rounded bg-zinc-900 p-1 text-xs"><option value="">Select agent</option>{data.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
              {!goal.projectId && <select aria-label={`Project for ${goal.title}`} value={delegationProjects[goal.id] ?? ""} onChange={event => setDelegationProjects(current => ({ ...current, [goal.id]: event.target.value }))} className="rounded bg-zinc-900 p-1 text-xs"><option value="" disabled>Select project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
              {!goal.projectId && projects.length === 0 && <a href="/projects" className="text-xs text-indigo-300 underline">Create a project</a>}
              <button disabled={busy || (!goal.projectId && !delegationProjects[goal.id])} className="rounded bg-indigo-600 px-2 py-1 text-xs" onClick={() => void apply(() => request(`/goals/${encodeURIComponent(goal.id)}/delegate`, "POST", { agentId: (document.getElementById(`delegate-${goal.id}`) as HTMLSelectElement).value, ...(!goal.projectId ? { projectId: delegationProjects[goal.id] } : {}) }))}>Delegate to task</button><button disabled={busy} className="rounded bg-zinc-700 px-2 py-1 text-xs" onClick={() => void apply(() => request(`/goals/${encodeURIComponent(goal.id)}`, "PATCH", { status: "completed" }))}>Complete</button></>}</div>
        </div><p className="mt-1 text-sm text-zinc-400">{goal.description}</p>
        {goal.status === "proposed" && !strategyReady(goal.id) && <p className="mt-1 text-xs text-amber-300">Complete the CEO strategy task before approving this goal.</p>}
        <div className="mt-2 text-xs text-zinc-400">{data.goalTasks.filter(task => task.goalId === goal.id && ["completed", "done"].includes(task.status)).length} / {data.goalTasks.filter(task => task.goalId === goal.id).length} tasks complete</div>
        {data.goalTasks.filter(task => task.goalId === goal.id).map(task => <div key={task.id} className="mt-2 text-xs"><a href={`/tasks?taskId=${encodeURIComponent(task.id)}`} className="text-indigo-300 underline">{task.title} · {task.status}</a>{task.output && <p className="mt-1 whitespace-pre-wrap text-zinc-300">{task.output.slice(0, 2000)}</p>}</div>)}
      </article>)}
    </section>
  </main>;
}
