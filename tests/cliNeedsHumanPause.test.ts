import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  nowIso,
  type AgentNodeConfig,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { MemorySaver } from "@langchain/langgraph";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { extractStructuredResultEnvelope } from "../apps/server/src/runtime/execUtils";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { buildAgenticVeloraPackage, createAgenticVeloraMasterWorkflow, createAgenticVeloraStage3To8Workflow } from "../src/studio/seeds/agenticVeloraOrgSeed";

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
}

describe("CLI fenced-JSON needs_human pause and fail-closed workflow gates", () => {
  const principal = { userId: "user-hil", tenantId: "tenant-hil", principalKind: "user" as const };

  test("extractStructuredResultEnvelope normalizes event #186 fenced needs_human payload", () => {
    const raw = [
      "**Stage 4.2 is blocked. Route the workflow to Stage 3 clarification.**",
      "",
      "```json",
      JSON.stringify({
        status: "needs_human",
        blocked_stage: "4.2",
        next: "clarify",
        retry_implementation: false,
        required_input: "Authoritative employer rulings or explicit scope deferrals for C03–C08",
        resume_when: "B01 is ratified and plan.md and tasks.md are approved",
      }),
      "```",
    ].join("\n");

    const extracted = extractStructuredResultEnvelope(raw) as Record<string, unknown>;
    expect(extracted).toMatchObject({
      contractVersion: 1,
      status: "needs_human",
      needsHuman: {
        purpose: "approval",
        reason: "Authoritative employer rulings or explicit scope deferrals for C03–C08",
      },
    });
  });

  test("CLI agent emitting fenced needs_human with questions pauses for clarification and resumes with answers", async () => {
    const store = new InMemoryRunStore();
    const agent = createAgentRecord({ name: "SpecKit Clarify CLI" });
    const nIn = createNode("input", { x: 0, y: 0 });
    const nClarify = createNode("agent", { x: 1, y: 0 }, {
      agentId: agent.id,
      reinvokeOnClarification: true,
    } as AgentNodeConfig);
    const nOut = createNode("output", { x: 2, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("CLI Clarification Pause Test"),
      nodes: [nIn, nClarify, nOut],
      edges: [
        createEdge({ source: nIn.id, target: nClarify.id }),
        createEdge({ source: nClarify.id, target: nOut.id }),
      ],
    };

    const seenInputs: unknown[] = [];
    let turn = 0;
    const executor = new RunExecutor(
      store,
      {
        async *execute(input) {
          turn += 1;
          seenInputs.push(input.input);
          if (turn === 1) {
            const markdownWithNeedsHuman = [
              "Employer rulings required before planning:",
              "```json",
              JSON.stringify({
                status: "needs_human",
                reason: "Unresolved employer scope decisions C03 and C08",
                questions: [
                  { id: "Q1", question: "Which shift model should C03 use?", options: { A: "Single shift", B: "Multi-shift" } },
                  { id: "Q2", question: "Is 3-day weather forecast mandatory for C08?" },
                ],
              }),
              "```",
            ].join("\n");
            yield {
              type: "agent.completed" as const,
              timestamp: nowIso(),
              agentId: input.agent.id,
              nodeId: input.nodeId,
              runId: input.runId,
              payload: { content: markdownWithNeedsHuman },
            };
            return;
          }
          yield {
            type: "agent.completed" as const,
            timestamp: nowIso(),
            agentId: input.agent.id,
            nodeId: input.nodeId,
            runId: input.runId,
            payload: { content: "Clarifications recorded in spec.md; ready for plan." },
          };
        },
      },
      new MemorySaver(),
    );

    const runId = executor.start({ workflow, agents: [agent], input: { phase: "A.1" } }, undefined, principal);
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    const approvals = store.listApprovals(runId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].status).toBe("requested");
    expect(approvals[0].message).toContain("Unresolved employer scope decisions C03 and C08");

    const envelope = approvals[0].context?.envelope as { needsHuman?: { purpose?: string; questions?: Array<{ id: string; prompt: string }> } };
    expect(envelope?.needsHuman?.purpose).toBe("clarification");
    expect(envelope?.needsHuman?.questions?.map((q) => q.id)).toEqual(["Q1", "Q2"]);

    executor.resolveApproval(runId, approvals[0].id, {
      decision: "approved",
      response: "Clarification answers provided",
      clarificationAnswers: [
        { questionId: "Q1", value: "Option A: Single shift" },
        { questionId: "Q2", value: "Defer 3-day forecast to Phase A.2" },
      ],
    });

    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(turn).toBe(2);
    expect(JSON.stringify(seenInputs[1])).toContain("Option A: Single shift");
    expect(store.get(runId)?.run.output).toEqual({ content: "Clarifications recorded in spec.md; ready for plan." });
  });

  test("CLI agent emitting fenced status='blocked' halts fail-closed instead of pretending success", async () => {
    const store = new InMemoryRunStore();
    const agent = createAgentRecord({ name: "Blocked Implementer" });
    const nIn = createNode("input", { x: 0, y: 0 });
    const nImpl = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
    const nOut = createNode("output", { x: 2, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("CLI Blocked Fail-Closed Test"),
      nodes: [nIn, nImpl, nOut],
      edges: [
        createEdge({ source: nIn.id, target: nImpl.id }),
        createEdge({ source: nImpl.id, target: nOut.id }),
      ],
    };

    const executor = new RunExecutor(store, {
      async *execute(input) {
        yield {
          type: "agent.completed" as const,
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: {
            content: 'Prerequisite missing.\n```json\n{"status":"blocked","blocked_stage":"4.2","reason":"plan.md and tasks.md do not exist"}\n```',
          },
        };
      },
    });

    const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, principal);
    await waitFor(() => store.get(runId)?.run.status === "failed");
    expect(store.get(runId)?.run.result?.status).toBe("blocked");
  });

  test("Velora escalation approvals return to their originating stage", () => {
    const pkg = buildAgenticVeloraPackage();
    const wf = createAgenticVeloraMasterWorkflow();
    const issues = validateWorkflow(wf, pkg.agents, undefined, pkg.tools);
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);

    const conditionNodes = wf.nodes.filter((n) => n.type === "condition");
    const reviewByRouter = {
      "node-gate-after-specify": "node-supervisor-after-specify",
      "node-gate-after-plan": "node-supervisor-after-plan",
      "node-gate-after-tasks": "node-supervisor-after-tasks",
      "node-gate-converge": "node-speckit-converge",
      "node-gate-post-qa": "node-stage5-post-qa",
    };
    expect(conditionNodes.map((node) => node.id)).toEqual(Object.keys(reviewByRouter));
    for (const gate of conditionNodes) {
      expect((gate.config as { unknownRoute?: string }).unknownRoute).toBe("escalate_human");
      const escalation = wf.edges.find((edge) => edge.source === gate.id && edge.branchKey === "escalate_human");
      expect(wf.nodes.find((node) => node.id === escalation?.target)).toMatchObject({
        type: "approval", config: { requireFreshApproval: true },
      });
      expect(wf.edges.filter((edge) => edge.source === escalation?.target)).toMatchObject([
        { target: reviewByRouter[gate.id as keyof typeof reviewByRouter], kind: "conditional", branchKey: "approved" },
        { target: "node-output", kind: "conditional", branchKey: "rejected" },
      ]);
    }

    const guards = wf.archetypeConfig?.recursionGuards ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(9);
    for (const guard of guards) {
      expect(guard.fallbackBranch).toBe("escalate_human");
    }
  });

  test("approving a Velora specification escalation reopens review with notes and requires a fresh decision if blocked again", async () => {
    const master = createAgenticVeloraMasterWorkflow();
    const inputId = "node-input";
    const reviewId = "node-supervisor-after-specify";
    const approvalId = "node-human-escalation-after-specify";
    const routerId = "node-gate-after-specify";
    const planId = "node-speckit-plan";
    const outputId = "node-output";
    const nodeIds = new Set([inputId, reviewId, approvalId, routerId, planId, outputId]);
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("Velora specification escalation"),
      nodes: master.nodes.filter((node) => nodeIds.has(node.id)).map((node) =>
        node.id === routerId
          ? { ...node, config: { valueSource: "last_value", valueField: "next", unknownRoute: "escalate_human", branches: [
              { key: "proceed", label: "Plan" },
              { key: "escalate_human", label: "Human review" },
            ] } }
          : node),
      edges: [
        ...master.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
        createEdge({ source: inputId, target: reviewId }),
        createEdge({ source: planId, target: outputId }),
      ],
    };
    const reviewInputs: unknown[] = [];
    const store = new InMemoryRunStore();
    const executor = new RunExecutor(store, {
      async *execute(input) {
        let content = "Plan created";
        if (input.nodeId === reviewId) {
          reviewInputs.push(input.input);
          content = JSON.stringify({ next: reviewInputs.length < 3 ? "escalate_human" : "proceed" });
        }
        yield {
          type: "agent.completed",
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: { content },
        };
      },
    });
    const { agents, tools } = buildAgenticVeloraPackage();
    const runId = executor.start({ workflow, agents, tools, input: {} }, undefined, principal);
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    const first = store.listApprovals(runId)[0];
    expect(first.nodeId).toBe(approvalId);
    executor.approveRun(runId, { notes: "Recheck the handoff" });

    await waitFor(() => store.listApprovals(runId).some((approval) => approval.id !== first.id && approval.status === "requested"));
    expect(reviewInputs[1]).toMatchObject({ decision: "approved", response: "Recheck the handoff" });
    expect(store.get(runId)?.events.some((event) => event.nodeId === planId)).toBe(false);
    executor.approveRun(runId, { notes: "Acceptance representative deferred to B06" });

    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(reviewInputs[2]).toMatchObject({ decision: "approved", response: "Acceptance representative deferred to B06" });
    expect(store.get(runId)?.run.output).toEqual({ content: "Plan created" });
  });
  test.each([
    { startPackage: "B01", expected: ["B01", "B02", "B03", "B04", "B05", "B06"], badReceipt: false },
    { startPackage: "B02", expected: ["B02", "B03", "B04", "B05", "B06"], badReceipt: false },
    { startPackage: "B02", expected: ["B02"], badReceipt: true },
  ])("A.1 advances from $startPackage only after package completion (bad receipt: $badReceipt)", async ({ startPackage, expected, badReceipt }) => {
    const { agents, tools } = buildAgenticVeloraPackage();
    const workflow = createAgenticVeloraStage3To8Workflow();
    const store = new InMemoryRunStore();
    const transitions: string[] = [];
    let invalidReceipt = badReceipt;
    const executor = new RunExecutor(store, {
      async *execute(input) {
        const packageId = input.taskInstruction?.match(/^CURRENT WORK PACKAGE: (B\d{2})\./)?.[1];
        expect(packageId).toBeDefined();
        let output: Record<string, unknown> = { result: "ok" };
        switch (input.nodeId) {
          case "node-speckit-specify":
            expect(input.resumeSession).toBeUndefined();
            expect(input.input).toMatchObject({ workPackage: { id: packageId } });
            transitions.push(`specify:${packageId}`);
            break;
          case "node-supervisor-after-specify":
          case "node-supervisor-after-plan":
          case "node-supervisor-after-tasks":
            output = { next: "proceed" };
            break;
          case "node-speckit-implement":
            transitions.push(`implement:${packageId}`);
            break;
          case "node-speckit-converge":
            output = { verdict: "converged" };
            break;
          case "node-stage5-post-qa":
            output = { qaStatus: "qa_passed" };
            break;
          case "node-stage8-knowledge-sync":
            transitions.push(`sync:${packageId}`);
            output = { status: "completed", workPackage: invalidReceipt ? "B01" : packageId };
            break;
        }
        yield {
          type: "agent.completed",
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: { content: JSON.stringify(output) },
        };
      },
    }, new MemorySaver());
    const runId = executor.start({
      workflow, agents, tools, input: { startPackage, ...(badReceipt ? { endPackage: "B03" } : {}) },
    }, undefined, principal);
    await waitFor(() => ["completed", "failed"].includes(store.get(runId)?.run.status ?? ""));
    expect(transitions).toEqual(expected.flatMap((id) => [`specify:${id}`, `implement:${id}`, `sync:${id}`]));
    const run = store.get(runId)?.run;
    if (badReceipt) {
      expect(run?.result?.error?.code).toBe("WORK_PACKAGE_COMPLETION_UNVERIFIED");
      invalidReceipt = false;
      const retryId = await executor.retry(runId);
      await waitFor(() => store.get(retryId)?.run.status === "completed");
      expect(transitions).toEqual(["specify:B02", "implement:B02", "sync:B02", "sync:B02", "specify:B03", "implement:B03", "sync:B03"]);
      expect(store.get(retryId)?.run.output).toMatchObject({ workPackages: [{ id: "B02" }, { id: "B03" }] });
    } else expect(run?.output).toMatchObject({ status: "completed", workPackages: expected.map((id) => ({ id })) });
  });
});
