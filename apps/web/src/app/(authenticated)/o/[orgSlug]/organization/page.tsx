"use client";

import { useOrgPath } from "@/components/organization/OrgProvider";

import { scopedApiPath } from "@/lib/orgRoute";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Bot, Network, Target } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";

interface Agent { id: string; name: string }
interface Line { agentId: string; managerAgentId: string | null; role: "ceo" | "manager" | "member" }
interface Goal { id: string; title: string; description: string; status: "proposed" | "active" | "completed" | "cancelled"; parentGoalId: string | null; ownerAgentId: string | null; projectId: string | null }
interface GoalTask { id: string; title: string; status: string; output: string | null; goalId: string; parentTaskId: string | null; strategyProposal: boolean }
interface Overview { agents: Agent[]; reportingLines: Line[]; goals: Goal[]; goalTasks: GoalTask[] }
const base = "/api/execution/studio/organization";

async function request(path: string, method: string, body?: object) {
  const response = await fetch(scopedApiPath(base + path), { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}

export default function OrganizationPage() {
  const orgUrl = useOrgPath();
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
  useEffect(() => { void reload(); void fetch(scopedApiPath("/api/execution/studio/projects")).then(r => r.json()).then(items => setProjects(Array.isArray(items) ? items : [])).catch(() => {}); }, [reload]);
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
  return (
    <PageContainer className="space-y-6">
      <header className="flex items-center gap-3 border-b border-zinc-800 pb-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
          <Network className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Organization and goals</h1>
          <p className="text-xs text-zinc-400">
            Define reporting lines, review strategy proposals, and delegate goals as tasks.
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

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Reporting lines</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Assign executive and manager roles across registered agents.
          </p>
        </div>
        {data.agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-8 text-center">
            <Bot className="mx-auto mb-2 h-6 w-6 text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">No agents registered yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Create agents in the registry to configure reporting lines and goal ownership.{" "}
              <Link href={orgUrl("/org/agents")} className="text-indigo-300 font-medium hover:underline">
                Open Agent Registry →
              </Link>
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.agents.map(agent => {
              const line = data.reportingLines.find(item => item.agentId === agent.id);
              return (
                <div
                  key={`${agent.id}:${line?.role ?? ""}:${line?.managerAgentId ?? ""}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2.5"
                >
                  <div className="text-sm font-semibold text-zinc-100">{agent.name}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`${agent.name} role`}
                      defaultValue={line?.role ?? ""}
                      id={`role-${agent.id}`}
                      className="studio-select h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <option value="">Select role</option>
                      <option value="ceo">CEO</option>
                      <option value="manager">Manager</option>
                      <option value="member">Member</option>
                    </select>
                    <select
                      aria-label={`${agent.name} manager`}
                      defaultValue={line?.managerAgentId ?? ""}
                      id={`manager-${agent.id}`}
                      className="studio-select h-9 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <option value="">No manager</option>
                      {data.agents.filter(other => other.id !== agent.id).map(other => (
                        <option key={other.id} value={other.id}>{other.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      className="h-9 rounded-lg bg-indigo-600 px-3.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 cursor-pointer"
                      onClick={() =>
                        void apply(() =>
                          request(`/agents/${encodeURIComponent(agent.id)}`, "PUT", {
                            role: (document.getElementById(`role-${agent.id}`) as HTMLSelectElement).value,
                            managerAgentId:
                              (document.getElementById(`manager-${agent.id}`) as HTMLSelectElement).value || null,
                          }),
                        )
                      }
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">New goal</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Create an organizational or project-scoped goal and assign an owner agent.
          </p>
        </div>
        <form
          className="grid gap-3.5 md:grid-cols-2"
          onSubmit={event => {
            event.preventDefault();
            if (ceoProposal && !projectId) return;
            void apply(async () => {
              if (ceoProposal) await request("/strategy", "POST", { title, brief: description, projectId });
              else
                await request("/goals", "POST", {
                  title,
                  description,
                  ownerAgentId: ownerAgentId || null,
                  parentGoalId: parentGoalId || null,
                  projectId: projectId || null,
                });
              setTitle("");
              setDescription("");
            });
          }}
        >
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-300">Goal title *</span>
            <input
              required
              maxLength={200}
              placeholder="e.g. Ship v2 multi-agent runtime"
              aria-label="Goal title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-300">
              {ceoProposal ? "Strategy brief *" : "Description"}
            </span>
            <input
              maxLength={4000}
              required={ceoProposal}
              placeholder={ceoProposal ? "Strategy brief for CEO agent" : "Key outcomes and acceptance criteria"}
              aria-label="Goal description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-300">Owner agent</span>
            <select
              aria-label="Goal owner agent"
              value={ownerAgentId}
              onChange={event => setOwnerAgentId(event.target.value)}
              className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="">No owner</option>
              {data.agents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-300">Parent goal</span>
            <select
              aria-label="Parent goal"
              value={parentGoalId}
              onChange={event => setParentGoalId(event.target.value)}
              className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="">Company goal</option>
              {data.goals.map(goal => (
                <option key={goal.id} value={goal.id}>{goal.title}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-300">Project</span>
            <select
              aria-label="Project"
              required={ceoProposal}
              value={projectId}
              onChange={event => setProjectId(event.target.value)}
              className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="" disabled={ceoProposal}>{ceoProposal ? "Select project" : "No project"}</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end pb-1">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={ceoProposal}
                disabled={!data.reportingLines.some(line => line.role === "ceo")}
                onChange={event => setCeoProposal(event.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              CEO strategy proposal
            </label>
            {ceoProposal && projects.length === 0 && (
              <p className="mt-1 text-xs text-zinc-400">
                <Link href={orgUrl("/projects")} className="text-indigo-300 underline">Create a project</Link> to request a strategy proposal.
              </p>
            )}
          </div>
          <div className="md:col-span-2 flex justify-end pt-1">
            <button
              type="submit"
              disabled={busy || (ceoProposal && !projectId)}
              className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Creating…" : "Create goal"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <h2 className="text-base font-semibold text-zinc-100">Goal tree</h2>
        {data.goals.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-8 text-center">
            <Target className="mx-auto mb-2 h-6 w-6 text-zinc-500" aria-hidden="true" />
            <p className="text-sm text-zinc-400">No goals yet.</p>
          </div>
        )}
        {data.goals.map(goal => (
          <article
            key={goal.id}
            className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
            style={{ marginLeft: goal.parentGoalId ? 20 : 0 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-semibold text-zinc-100">{goal.title}</strong>
                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                  {goal.status} · {name(goal.ownerAgentId)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {goal.status === "proposed" && (
                  <button
                    type="button"
                    disabled={busy || !strategyReady(goal.id)}
                    title={!strategyReady(goal.id) ? "The CEO strategy task must finish first" : undefined}
                    className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                    onClick={() => void apply(() => request(`/goals/${encodeURIComponent(goal.id)}`, "PATCH", { status: "active" }))}
                  >
                    Approve
                  </button>
                )}
                {goal.status === "active" && (
                  <>
                    <select
                      aria-label={`Delegate ${goal.title}`}
                      id={`delegate-${goal.id}`}
                      className="studio-select h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100"
                    >
                      <option value="">Select agent</option>
                      {data.agents.map(agent => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    {!goal.projectId && (
                      <select
                        aria-label={`Project for ${goal.title}`}
                        value={delegationProjects[goal.id] ?? ""}
                        onChange={event => setDelegationProjects(current => ({ ...current, [goal.id]: event.target.value }))}
                        className="studio-select h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100"
                      >
                        <option value="" disabled>Select project</option>
                        {projects.map(project => (
                          <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                      </select>
                    )}
                    {!goal.projectId && projects.length === 0 && (
                      <Link href={orgUrl("/projects")} className="text-xs text-indigo-300 underline">Create a project</Link>
                    )}
                    <button
                      type="button"
                      disabled={busy || (!goal.projectId && !delegationProjects[goal.id])}
                      className="h-8 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                      onClick={() =>
                        void apply(() =>
                          request(`/goals/${encodeURIComponent(goal.id)}/delegate`, "POST", {
                            agentId: (document.getElementById(`delegate-${goal.id}`) as HTMLSelectElement).value,
                            ...(!goal.projectId ? { projectId: delegationProjects[goal.id] } : {}),
                          }),
                        )
                      }
                    >
                      Delegate to task
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="h-8 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                      onClick={() => void apply(() => request(`/goals/${encodeURIComponent(goal.id)}`, "PATCH", { status: "completed" }))}
                    >
                      Complete
                    </button>
                  </>
                )}
              </div>
            </div>
            {goal.description && <p className="mt-1.5 text-sm text-zinc-400">{goal.description}</p>}
            {goal.status === "proposed" && !strategyReady(goal.id) && (
              <p className="mt-1.5 text-xs text-amber-300">Complete the CEO strategy task before approving this goal.</p>
            )}
            <div className="mt-2.5 text-xs text-zinc-400">
              {data.goalTasks.filter(task => task.goalId === goal.id && ["completed", "done"].includes(task.status)).length} /{" "}
              {data.goalTasks.filter(task => task.goalId === goal.id).length} tasks complete
            </div>
            {data.goalTasks.filter(task => task.goalId === goal.id).map(task => (
              <div key={task.id} className="mt-2 text-xs">
                <a href={orgUrl(`/tasks?taskId=${encodeURIComponent(task.id)}`)} className="text-indigo-300 underline">
                  {task.title} · {task.status}
                </a>
                {task.output && <p className="mt-1 whitespace-pre-wrap text-zinc-300">{task.output.slice(0, 2000)}</p>}
              </div>
            ))}
          </article>
        ))}
      </section>
    </PageContainer>
  );
}
