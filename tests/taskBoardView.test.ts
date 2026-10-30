import {
  DEFAULT_TASK_BOARD_FILTERS,
  countActiveFilters,
  filterTasks,
  getActiveFilterChips,
  groupTasksByColumn,
  parseFilterSearchParams,
  serializeFilterSearchParams,
  validateMove,
  validateStart,
} from "../apps/web/src/lib/taskBoardView";
import type { Task, TaskStatus } from "../apps/web/src/lib/taskStatus";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "project-1",
    workspaceId: null,
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
    task({
      id: "1",
      title: "Fix login",
      description: "auth flow",
      priority: "high",
      status: "running",
      workspaceId: "ws-alpha",
      projectId: "proj-web",
      assignedAgent: "agent-a",
      workflowId: "wf-1",
      paused: false,
    }),
    task({
      id: "2",
      title: "Write docs",
      description: "readme",
      priority: "low",
      status: "completed",
      workspaceId: "ws-beta",
      projectId: "proj-docs",
      assignedAgent: null,
      workflowId: null,
      paused: false,
    }),
    task({
      id: "3",
      title: "Review PR",
      description: "code review",
      priority: "medium",
      status: "waiting_for_human",
      workspaceId: null,
      projectId: "",
      assignedAgents: ["agent-b"],
      workflowId: null,
      paused: true,
      dependencies: ["1"],
    }),
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

  it("filters by workspace (specific UUID, unassigned, all)", () => {
    const base = { ...DEFAULT_TASK_BOARD_FILTERS };
    expect(filterTasks(tasks, { ...base, workspaceId: "ws-alpha" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...base, workspaceId: "ws-beta" }).map((t) => t.id)).toEqual(["2"]);
    expect(filterTasks(tasks, { ...base, workspaceId: "unassigned" }).map((t) => t.id)).toEqual(["3"]);
    expect(filterTasks(tasks, { ...base, workspaceId: "all" })).toHaveLength(3);
  });

  it("filters by project (specific UUID, unassigned, all)", () => {
    const base = { ...DEFAULT_TASK_BOARD_FILTERS };
    expect(filterTasks(tasks, { ...base, projectId: "proj-web" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...base, projectId: "proj-docs" }).map((t) => t.id)).toEqual(["2"]);
    expect(filterTasks(tasks, { ...base, projectId: "unassigned" }).map((t) => t.id)).toEqual(["3"]);
    expect(filterTasks(tasks, { ...base, projectId: "all" })).toHaveLength(3);
  });

  it("filters by status (exact status and column mapped statuses)", () => {
    const base = { ...DEFAULT_TASK_BOARD_FILTERS };
    expect(filterTasks(tasks, { ...base, status: "running" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...base, status: "completed" }).map((t) => t.id)).toEqual(["2"]);
    // Column category 'waiting' maps waiting_for_human, blocked, waiting_tool, review
    expect(filterTasks(tasks, { ...base, status: "waiting" }).map((t) => t.id)).toEqual(["3"]);
    // Column category 'done' maps completed, done
    expect(filterTasks(tasks, { ...base, status: "done" }).map((t) => t.id)).toEqual(["2"]);
  });

  it("filters by operational state (paused and blocked)", () => {
    const base = { ...DEFAULT_TASK_BOARD_FILTERS };
    expect(filterTasks(tasks, { ...base, operationalState: "paused" }).map((t) => t.id)).toEqual(["3"]);

    // Task 3 has dependency Task 1 (which is running, not completed -> blocked)
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(
      filterTasks(tasks, { ...base, operationalState: "blocked" }, { tasksById: byId }).map(
        (t) => t.id,
      ),
    ).toEqual(["3"]);
  });

  it("applies multiple filters simultaneously (conjunction AND)", () => {
    const match = filterTasks(tasks, {
      ...DEFAULT_TASK_BOARD_FILTERS,
      workspaceId: "ws-alpha",
      projectId: "proj-web",
      status: "running",
      priority: "high",
    });
    expect(match.map((t) => t.id)).toEqual(["1"]);

    const noMatch = filterTasks(tasks, {
      ...DEFAULT_TASK_BOARD_FILTERS,
      workspaceId: "ws-alpha",
      projectId: "proj-docs", // does not match Task 1
      status: "running",
    });
    expect(noMatch).toHaveLength(0);
  });
});

describe("countActiveFilters & getActiveFilterChips", () => {
  it("computes count of non-default filters", () => {
    expect(countActiveFilters(DEFAULT_TASK_BOARD_FILTERS)).toBe(0);
    expect(
      countActiveFilters({
        ...DEFAULT_TASK_BOARD_FILTERS,
        search: "auth",
        priority: "high",
        workspaceId: "ws-1",
      }),
    ).toBe(3);
  });

  it("generates active filter chips with human readable labels", () => {
    const lookups = {
      workspaceNamesById: new Map([["ws-1", "Workspace Alpha"]]),
      projectNamesById: new Map([["proj-1", "Project Beta"]]),
      workflowsById: new Map([["wf-1", "CI Deploy"]]),
    };
    const chips = getActiveFilterChips(
      {
        ...DEFAULT_TASK_BOARD_FILTERS,
        workspaceId: "ws-1",
        projectId: "proj-1",
        priority: "high",
        operationalState: "paused",
      },
      lookups,
    );
    expect(chips).toEqual([
      { id: "workspace", key: "workspaceId", category: "Workspace", label: "Workspace Alpha" },
      { id: "project", key: "projectId", category: "Project", label: "Project Beta" },
      { id: "priority", key: "priority", category: "Priority", label: "High" },
      { id: "operationalState", key: "operationalState", category: "State", label: "Paused" },
    ]);
  });
});

describe("URL Search Params Serialization & Parsing", () => {
  it("serializes and parses filters symmetrically", () => {
    const filters = {
      ...DEFAULT_TASK_BOARD_FILTERS,
      search: "login",
      status: "running" as TaskStatus,
      workspaceId: "ws-xyz",
      projectId: "proj-123",
      priority: "high" as const,
      operationalState: "paused" as const,
    };

    const params = serializeFilterSearchParams(filters);
    expect(params.get("q")).toBe("login");
    expect(params.get("status")).toBe("running");
    expect(params.get("workspace")).toBe("ws-xyz");
    expect(params.get("project")).toBe("proj-123");
    expect(params.get("priority")).toBe("high");
    expect(params.get("state")).toBe("paused");
    // defaults omitted
    expect(params.has("agent")).toBe(false);

    const parsed = parseFilterSearchParams(params);
    expect(parsed.search).toBe("login");
    expect(parsed.status).toBe("running");
    expect(parsed.workspaceId).toBe("ws-xyz");
    expect(parsed.projectId).toBe("proj-123");
    expect(parsed.priority).toBe("high");
    expect(parsed.operationalState).toBe("paused");
    expect(parsed.agent).toBe("all");
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
