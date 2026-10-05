import { randomUUID } from "node:crypto";
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  createResultEnvelope,
  createSingleAgentWorkflow,
  nowIso,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";
import {
  buildClarificationPackage,
  extractLegacyClarificationQuestions,
  fingerprintAnswers,
  validateClarificationAnswers,
} from "../apps/server/src/api/clarification";
import { ApiError } from "../apps/server/src/api/shared/http";

const TEST_SECRET = "clarification-response-test-secret";
const alice: AuthenticatedPrincipal = { userId: "alice-user", tenantId: "tenant-alpha" };
const eve: AuthenticatedPrincipal = { userId: "eve-user", tenantId: "tenant-beta" };

function authHeaders(principal?: AuthenticatedPrincipal): HeadersInit {
  if (!principal) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "X-Multi-Agent-Principal": createInternalPrincipalAssertion(principal, TEST_SECRET),
  };
}

async function json<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function fakeRuntime(respond: (agent: AgentRecord) => unknown) {
  return {
    async *execute(input: { agent: AgentRecord; nodeId: string; runId: string }) {
      yield {
        type: "agent.completed" as const,
        timestamp: nowIso(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload: { content: respond(input.agent) },
      };
    },
  };
}

function linearAgentWorkflow() {
  const agent = { ...createAgentRecord({ name: "Fake", model: "gpt-4o" }), id: "agent-clarification" };
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition("clarification"),
    nodes: [input, agentNode, output],
    edges: [createEdge({ source: input.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: output.id })],
  };
  return { workflow, agent };
}

describe("clarification helpers", () => {
  it("extracts numbered legacy questions deterministically and refuses invented prompts", () => {
    const text = [
      "Clarification required before implementation can be assigned.",
      "1. What is the target environment?",
      "2. Who is the product owner?",
    ].join("\n");
    const questions = extractLegacyClarificationQuestions(text);
    expect(questions).toHaveLength(2);
    expect(questions[0]?.id).toBe("legacy-q1");
    expect(extractLegacyClarificationQuestions("The intake remains in clarification.")).toEqual([]);
  });

  it("rejects empty or malformed answer payloads", () => {
    const questions = [{ id: "q1", prompt: "Name?", required: true }];
    expect(() => validateClarificationAnswers(questions, [])).toThrow(ApiError);
    expect(() => validateClarificationAnswers(questions, [{ questionId: "q1", value: "  " }])).toThrow(ApiError);
    expect(() => validateClarificationAnswers(questions, [{ questionId: "other", value: "x" }])).toThrow(ApiError);
    expect(fingerprintAnswers([{ questionId: "q1", value: "a" }])).toEqual(
      fingerprintAnswers([{ questionId: "q1", value: "a" }]),
    );
  });
});

describe("clarification response end-to-end", () => {
  let studioStore: InMemoryStudioStore;
  let runStore: InMemoryRunStore;
  let providerCalls: number;
  let studioApp: ReturnType<typeof createStudioRouter>;
  let runsApp: ReturnType<typeof createRunsRouter>["app"];
  let executor: RunExecutor;
  let taskAssoc: { workspaceId: string; projectIds: string[] };

  const sampleAgent: AgentRecord = {
    ...createAgentRecord({ name: "Alpha Dev Agent" }),
    id: "agent-alpha-1",
  };

  beforeEach(async () => {
    studioStore = new InMemoryStudioStore();
    runStore = new InMemoryRunStore();
    providerCalls = 0;
    executor = new RunExecutor(
      runStore,
      fakeRuntime(() => {
        providerCalls += 1;
        return createResultEnvelope("needs_human", {
          value: { proposal: true },
          needsHuman: {
            reason: "Need project details",
            purpose: "clarification",
            questions: [
              { id: "q-env", prompt: "What environment?", required: true },
              { id: "q-owner", prompt: "Who owns this?", required: true },
            ],
            missingFields: ["environment", "owner"],
          },
        });
      }),
    );
    const resolvePrincipal = (request: Request) => {
      const token = request.headers.get("X-Multi-Agent-Principal");
      if (!token) return null;
      try {
        return verifyInternalPrincipalAssertion(token, TEST_SECRET);
      } catch {
        return null;
      }
    };
    studioApp = createStudioRouter(studioStore, resolvePrincipal, executor);
    runsApp = createRunsRouter(executor, async () => null, studioStore, resolvePrincipal).app;

    await studioStore.saveAgent(sampleAgent, alice);
    await studioApp.fetch(studioReq("/projects", "GET", undefined, alice));
    const projects = await studioStore.listProjects(alice, "active");
    const workspaces = await studioStore.listWorkspaces(alice, "active");
    taskAssoc = { workspaceId: workspaces[0]!.id, projectIds: [projects[0]!.id] };
  });

  function studioReq(path: string, method = "GET", body?: unknown, principal: AuthenticatedPrincipal = alice) {
    let payload = body;
    if (method === "POST" && path === "/tasks" && body && typeof body === "object" && !Array.isArray(body)) {
      payload = { ...taskAssoc, ...(body as object) };
    }
    return new Request(`http://localhost${path}`, {
      method,
      headers: authHeaders(principal),
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  function runsReq(path: string, method = "GET", body?: unknown, principal: AuthenticatedPrincipal = alice) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: authHeaders(principal),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // createRunsRouter is mounted at /runs in production; tests hit the router root.

  it("keeps task out of Done, persists questions, resumes without extra provider call", async () => {
    const task = await json<{ id: string }>(
      await studioApp.fetch(studioReq("/tasks", "POST", {
        title: "Needs clarification",
        status: "ready",
        assignedAgents: [sampleAgent.id],
      })),
    );
    const started = await json<{ runId: string }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}/start`, "POST")),
    );
    await waitFor(() => runStore.get(started.runId)?.run.status === "waiting_for_human");
    expect(providerCalls).toBe(1);

    const synced = await json<{ status: string; completedAt: string | null }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}`)),
    );
    expect(synced.status).toBe("waiting_for_human");
    expect(synced.completedAt).toBeNull();

    const pkg = await json<{
      status: string;
      questions: Array<{ id: string }>;
      canSubmit: boolean;
      continuation: string;
      extraction: string;
    }>(await runsApp.fetch(runsReq(`/${started.runId}/clarification`)));
    expect(pkg.status).toBe("pending");
    expect(pkg.questions).toHaveLength(2);
    expect(pkg.canSubmit).toBe(true);
    expect(pkg.continuation).toBe("resume");
    expect(pkg.extraction).toBe("structured");

    const submit = await json<{ ok: boolean; idempotentReplay?: boolean }>(
      await runsApp.fetch(runsReq(`/${started.runId}/clarification`, "POST", {
        answers: [
          { questionId: "q-env", value: "staging" },
          { questionId: "q-owner", value: "platform" },
        ],
      })),
    );
    expect(submit.ok).toBe(true);
    await waitFor(() => runStore.get(started.runId)?.run.status === "completed");
    expect(providerCalls).toBe(1);

    const replay = await json<{ ok: boolean; idempotentReplay?: boolean }>(
      await runsApp.fetch(runsReq(`/${started.runId}/clarification`, "POST", {
        answers: [
          { questionId: "q-env", value: "staging" },
          { questionId: "q-owner", value: "platform" },
        ],
      })),
    );
    expect(replay.ok).toBe(true);
    expect(replay.idempotentReplay).toBe(true);
  });

  it("rejects empty answers and cross-tenant access", async () => {
    const { workflow, agent } = linearAgentWorkflow();
    await studioStore.saveAgent(agent, alice);
    const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, alice);
    await waitFor(() => runStore.get(runId)?.run.status === "waiting_for_human");

    const bad = await runsApp.fetch(runsReq(`/${runId}/clarification`, "POST", { answers: [] }));
    expect(bad.status).toBe(400);

    const denied = await runsApp.fetch(runsReq(`/${runId}/clarification`, "GET", undefined, eve));
    expect(denied.status).toBe(404);
    const deniedBody = await json<{ error?: string; questions?: unknown }>(denied);
    expect(deniedBody.questions).toBeUndefined();
  });

  it("allows authorized task clarification GET and denies other tenant", async () => {
    const task = await json<{ id: string }>(
      await studioApp.fetch(studioReq("/tasks", "POST", {
        title: "Tenant check",
        status: "ready",
        assignedAgents: [sampleAgent.id],
      })),
    );
    const started = await json<{ runId: string }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}/start`, "POST")),
    );
    await waitFor(() => runStore.get(started.runId)?.run.status === "waiting_for_human");

    const ok = await studioApp.fetch(studioReq(`/tasks/${task.id}/clarification`));
    expect(ok.status).toBe(200);
    const pkg = await json<{ questions: unknown[] }>(ok);
    expect(pkg.questions.length).toBe(2);

    const denied = await studioApp.fetch(studioReq(`/tasks/${task.id}/clarification`, "GET", undefined, eve));
    expect([403, 404]).toContain(denied.status);
  });

  it("creates a controlled legacy follow-up only after explicit submit (fixture, not live IDs)", async () => {
    // Deterministic stand-in for sample task-munq01y0-5gglrn / run-munq68dw-paj0sl
    const task = await json<{ id: string }>(
      await studioApp.fetch(studioReq("/tasks", "POST", {
        title: "Legacy clarification fixture",
        status: "ready",
        assignedAgents: [sampleAgent.id],
      })),
    );
    const started = await json<{ runId: string }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}/start`, "POST")),
    );
    const clarification = [
      "Clarification required before implementation can be assigned; the intake remains in clarification.",
      "1. What repository should be used?",
      "2. What is the release window?",
    ].join("\n");

    // Swap agent runtime so follow-up succeeds without another needs_human pause.
    providerCalls = 0;
    const followExecutor = new RunExecutor(
      runStore,
      fakeRuntime(() => createResultEnvelope("success", { value: { done: true } })),
    );
    // Rebind studio app to followExecutor for follow-up start — use same store, new executor methods via direct service path:
    // Instead, complete the original run as legacy, then submit via TaskService on a router with success runtime.
    runStore.update(started.runId, {
      status: "completed",
      output: { content: clarification },
      result: createResultEnvelope("success", { value: { content: clarification } }),
    });
    runStore.append(started.runId, {
      id: randomUUID(),
      runId: started.runId,
      type: "run.completed",
      timestamp: new Date().toISOString(),
      sequence: 1,
      payload: { output: { content: clarification }, resultStatus: "success" },
    });

    const blockedTask = await json<{ status: string; completedAt: string | null; runId: string }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}`)),
    );
    expect(blockedTask.status).toBe("blocked");
    expect(blockedTask.completedAt).toBeNull();

    const beforeSubmit = await json<{ canSubmit: boolean; continuation: string; questions: unknown[]; extraction: string }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}/clarification`)),
    );
    expect(beforeSubmit.extraction).toBe("legacy_deterministic");
    expect(beforeSubmit.questions).toHaveLength(2);
    expect(beforeSubmit.canSubmit).toBe(true);
    expect(beforeSubmit.continuation).toBe("follow_up");

    // Wire a success executor on a fresh studio router sharing the same stores for follow-up.
    const successExecutor = new RunExecutor(
      runStore,
      fakeRuntime(() => createResultEnvelope("success", { value: { content: "implemented" } })),
    );
    const resolvePrincipal = (request: Request) => {
      const token = request.headers.get("X-Multi-Agent-Principal");
      if (!token) return null;
      try {
        return verifyInternalPrincipalAssertion(token, TEST_SECRET);
      } catch {
        return null;
      }
    };
    const followApp = createStudioRouter(studioStore, resolvePrincipal, successExecutor);

    const submitted = await json<{ ok: boolean; followUpRunId?: string | null }>(
      await followApp.fetch(studioReq(`/tasks/${task.id}/clarification`, "POST", {
        answers: [
          { questionId: "legacy-q1", value: "multi-agent" },
          { questionId: "legacy-q2", value: "next sprint" },
        ],
      })),
    );
    expect(submitted.ok).toBe(true);
    expect(submitted.followUpRunId).toBeTruthy();
    expect(submitted.followUpRunId).not.toBe(started.runId);

    const running = await json<{ status: string; runId: string; metadata?: Record<string, unknown> }>(
      await followApp.fetch(studioReq(`/tasks/${task.id}`)),
    );
    expect(running.runId).toBe(submitted.followUpRunId);
    expect(["running", "completed", "blocked", "waiting_for_human"]).toContain(running.status);
    expect(running.metadata?.parentRunId ?? running.metadata?.clarificationOfRunId).toBe(started.runId);

    const replay = await json<{ ok: boolean; idempotentReplay?: boolean; followUpRunId?: string | null }>(
      await followApp.fetch(studioReq(`/tasks/${task.id}/clarification`, "POST", {
        answers: [
          { questionId: "legacy-q1", value: "multi-agent" },
          { questionId: "legacy-q2", value: "next sprint" },
        ],
      })),
    );
    expect(replay.ok).toBe(true);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.followUpRunId).toBe(submitted.followUpRunId);
  });

  it("builds unavailable package when legacy text has no extractable questions", () => {
    const pkg = buildClarificationPackage({
      run: {
        id: "run-legacy",
        workflowId: "wf",
        status: "completed",
        startedAt: nowIso(),
        output: { content: "Clarification required before implementation can be assigned; the intake remains in clarification." },
        result: createResultEnvelope("success", { value: { content: "Clarification required before implementation." } }),
        metadata: {},
      } as never,
      approvals: [],
      taskId: "task-legacy",
    });
    expect(pkg.extraction).toBe("unavailable");
    expect(pkg.questions).toEqual([]);
    expect(pkg.canSubmit).toBe(false);
  });

  it("does not mark ordinary blocked runs as legacy-unavailable clarification", () => {
    const pkg = buildClarificationPackage({
      run: {
        id: "run-blocked",
        workflowId: "wf",
        status: "completed",
        startedAt: nowIso(),
        output: { content: "missing approved revision" },
        result: createResultEnvelope("blocked", {
          error: { code: "BLOCKED", message: "missing approved revision", retryable: false },
        }),
        metadata: {},
      } as never,
      approvals: [],
      taskId: "task-blocked",
    });
    expect(pkg.extraction).toBe("structured");
    expect(pkg.questions).toEqual([]);
    expect(pkg.canSubmit).toBe(false);
  });

  it("returns errorVisible and keeps task not Done when resume is unavailable", async () => {
    const task = await json<{ id: string }>(
      await studioApp.fetch(studioReq("/tasks", "POST", {
        title: "Resume failure",
        status: "ready",
        assignedAgents: [sampleAgent.id],
      })),
    );
    const started = await json<{ runId: string }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}/start`, "POST")),
    );
    await waitFor(() => runStore.get(started.runId)?.run.status === "waiting_for_human");

    executor.dropPausedState(started.runId);
    expect(executor.isRunResumable(started.runId)).toBe(false);

    const failed = await json<{ ok: boolean; errorVisible?: boolean }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}/clarification`, "POST", {
        answers: [
          { questionId: "q-env", value: "staging" },
          { questionId: "q-owner", value: "platform" },
        ],
      })),
    );
    expect(failed.ok).toBe(false);
    expect(failed.errorVisible).toBe(true);

    const after = await json<{ status: string; completedAt: string | null }>(
      await studioApp.fetch(studioReq(`/tasks/${task.id}`)),
    );
    expect(after.status).not.toBe("completed");
    expect(after.status).not.toBe("done");
    expect(after.completedAt).toBeNull();
    expect(runStore.get(started.runId)?.run.status).toBe("waiting_for_human");
  });
});
