import {
  filterTasks,
  groupTasksByColumn,
  validateMove,
  validateStart,
} from "../apps/web/src/lib/taskBoardView";
import type { Task, TaskStatus } from "../apps/web/src/lib/taskStatus";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Task",
    description: "",
    priority: "medium",
    status: "backlog",
    assignedAgent: null,
    dependencies: [],
    output: null,
    retryCount: 0,
    paused: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterTasks", () => {
  const tasks = [
    task({ id: "1", title: "Fix login", description: "auth flow", priority: "high", assignedAgent: "agent-a", workflowId: "wf-1" }),
    task({ id: "2", title: "Write docs", description: "readme", priority: "low", status: "completed" }),
    task({ id: "3", title: "Review PR", description: "", priority: "medium", assignedAgents: ["agent-b"] }),
  ];

  it("filters by search across title and description", () => {
    expect(filterTasks(tasks, { search: "login", priority: "all", agent: "all", workflow: "all" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { search: "readme", priority: "all", agent: "all", workflow: "all" }).map((t) => t.id)).toEqual(["2"]);
  });

  it("filters by priority, agent (direct and multi), and workflow", () => {
    const base = { search: "", workflow: "all" };
    expect(filterTasks(tasks, { ...base, priority: "high", agent: "all" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...base, priority: "all", agent: "agent-a" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...base, priority: "all", agent: "agent-b" }).map((t) => t.id)).toEqual(["3"]);
    expect(filterTasks(tasks, { ...base, priority: "all", agent: "all", workflow: "wf-1" }).map((t) => t.id)).toEqual(["1"]);
  });

  it("search is case-insensitive", () => {
    expect(filterTasks(tasks, { search: "FIX", priority: "all", agent: "all", workflow: "all" })).toHaveLength(1);
  });
});

describe("groupTasksByColumn", () => {
  it("maps domain statuses to canonical columns", () => {
    const grouped = groupTasksByColumn([
      task({ id: "a", status: "todo" }),
      task({ id: "b", status: "in_progress" }),
      task({ id: "c", status: "waiting_for_human" }),
      task({ id: "d", status: "done" }),
      task({ id: "e", status: "cancelled" }),
    ]);
    expect(grouped.get("backlog")!.map((t) => t.id)).toEqual(["a"]);
    expect(grouped.get("running")!.map((t) => t.id)).toEqual(["b"]);
    expect(grouped.get("waiting")!.map((t) => t.id)).toEqual(["c"]);
    expect(grouped.get("done")!.map((t) => t.id)).toEqual(["d"]);
    expect(grouped.get("failed")!.map((t) => t.id)).toEqual(["e"]);
  });

  it("sorts by priority then newest first within a column", () => {
    const grouped = groupTasksByColumn([
      task({ id: "old-low", priority: "low", createdAt: "2026-01-01T00:00:00.000Z" }),
      task({ id: "new-high", priority: "high", createdAt: "2026-01-02T00:00:00.000Z" }),
      task({ id: "old-high", priority: "high", createdAt: "2026-01-01T12:00:00.000Z" }),
    ]);
    expect(grouped.get("backlog")!.map((t) => t.id)).toEqual(["new-high", "old-high", "old-low"]);
  });
});

describe("validateMove", () => {
  const byId = (tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]));

  it("rejects no-op moves", () => {
    const t = task({ status: "backlog" });
    expect(validateMove(t, "backlog" as TaskStatus, byId([t])).ok).toBe(false);
  });

  it("rejects invalid transitions", () => {
    const t = task({ status: "completed" });
    const result = validateMove(t, "running" as TaskStatus, byId([t]));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Invalid transition");
  });

  it("rejects dependency-gated moves with blockers", () => {
    const dep = task({ id: "dep", status: "ready" });
    const t = task({ status: "backlog", dependencies: ["dep"], title: "Blocked task" });
    const result = validateMove(t, "running" as TaskStatus, byId([t, dep]));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("blocked by unfinished dependencies");
  });

  it("allows valid transitions when dependencies are completed", () => {
    const dep = task({ id: "dep", status: "completed" });
    const t = task({ status: "backlog", dependencies: ["dep"] });
    expect(validateMove(t, "running" as TaskStatus, byId([t, dep])).ok).toBe(true);
  });
});

describe("validateStart", () => {
  it("blocks start when dependencies are unfinished", () => {
    const dep = task({ id: "dep", status: "queued" });
    const t = task({ dependencies: ["dep"] });
    const result = validateStart(t, new Map([["dep", dep], ["t1", t]]));
    expect(result.ok).toBe(false);
  });

  it("allows start when dependencies are satisfied", () => {
    const dep = task({ id: "dep", status: "completed" });
    const t = task({ dependencies: ["dep"] });
    expect(validateStart(t, new Map([["dep", dep], ["t1", t]])).ok).toBe(true);
  });
});
