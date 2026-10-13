import type { AgentRecord, MemoryNamespace } from "@multi-agent/types";
import { DefaultContextAssembler, type ContextAssemblyRequest } from "../src/agents/runtime/contextAssembler";

function sampleAgent(id: string): AgentRecord {
  return {
    id,
    name: "Test Agent",
    description: "",
    backend: { type: "local", provider: "ollama", model: "llama3" },
    systemPrompt: "You are a test agent",
    tools: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("organization memory precedence in context assembler (T060 / US4)", () => {
  it("enforces precedence: project memory overrides conflicting organization memory", async () => {
    const assembler = new DefaultContextAssembler();

    const orgNs: MemoryNamespace = { scope: "organization", id: "org-1" };
    const projectNs: MemoryNamespace = { scope: "project", id: "proj-1" };

    const ltmContext = JSON.stringify({
      type: "long_term_memory",
      memories: [
        {
          id: "mem-org-1",
          kind: "semantic",
          subject: "package-manager",
          content: "The company package manager is npm.",
          namespace: orgNs,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "mem-proj-1",
          kind: "semantic",
          subject: "package-manager",
          content: "The project package manager is pnpm.",
          namespace: projectNs,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    const request: ContextAssemblyRequest = {
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "node-1",
      agentId: "agent-1",
      agent: sampleAgent("agent-1"),
      task: "Install project dependencies",
      longTermMemoryContext: ltmContext,
    };

    const assembled = await assembler.assemble(request);
    const ltmItem = assembled.items.find((i) => i.source === "long_term_memory");
    expect(ltmItem).toBeDefined();

    const parsed = JSON.parse((ltmItem!.content as { text: string }).text);
    // Project memory must be retained; conflicting organization memory must be overridden/suppressed
    expect(parsed.memories.some((m: { id: string }) => m.id === "mem-proj-1")).toBe(true);
    expect(parsed.memories.some((m: { id: string }) => m.id === "mem-org-1")).toBe(false);
  });

  it("enforces precedence: agent memory overrides project and organization memory", async () => {
    const assembler = new DefaultContextAssembler();

    const orgNs: MemoryNamespace = { scope: "organization", id: "org-1" };
    const agentNs: MemoryNamespace = { scope: "agent", id: "agent-1" };

    const ltmContext = JSON.stringify({
      type: "long_term_memory",
      memories: [
        {
          id: "mem-org-lang",
          kind: "semantic",
          subject: "primary-language",
          content: "Organization standard language is Python.",
          namespace: orgNs,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "mem-agent-lang",
          kind: "semantic",
          subject: "primary-language",
          content: "Agent specialized language is TypeScript.",
          namespace: agentNs,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    const request: ContextAssemblyRequest = {
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "node-1",
      agentId: "agent-1",
      agent: sampleAgent("agent-1"),
      task: "Write backend service",
      longTermMemoryContext: ltmContext,
    };

    const assembled = await assembler.assemble(request);
    const ltmItem = assembled.items.find((i) => i.source === "long_term_memory");
    expect(ltmItem).toBeDefined();

    const parsed = JSON.parse((ltmItem!.content as { text: string }).text);
    expect(parsed.memories.some((m: { id: string }) => m.id === "mem-agent-lang")).toBe(true);
    expect(parsed.memories.some((m: { id: string }) => m.id === "mem-org-lang")).toBe(false);
  });

  it("handles temporal supersession where a newer organization memory supersedes an older one", async () => {
    const assembler = new DefaultContextAssembler();
    const orgNs: MemoryNamespace = { scope: "organization", id: "org-1" };

    const ltmContext = JSON.stringify({
      type: "long_term_memory",
      memories: [
        {
          id: "mem-org-old",
          kind: "semantic",
          subject: "cloud-region",
          content: "Deployment region is us-east-1.",
          namespace: orgNs,
          updatedAt: "2026-01-01T00:00:00.000Z",
          supersededByMemoryId: "mem-org-new",
        },
        {
          id: "mem-org-new",
          kind: "semantic",
          subject: "cloud-region",
          content: "Deployment region was migrated from us-east-1 to eu-west-1.",
          namespace: orgNs,
          updatedAt: "2026-06-01T00:00:00.000Z",
          supersedesMemoryId: "mem-org-old",
        },
      ],
    });

    const request: ContextAssemblyRequest = {
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "node-1",
      agentId: "agent-1",
      agent: sampleAgent("agent-1"),
      task: "Deploy infrastructure",
      longTermMemoryContext: ltmContext,
    };

    const assembled = await assembler.assemble(request);
    const ltmItem = assembled.items.find((i) => i.source === "long_term_memory");
    expect(ltmItem).toBeDefined();

    const parsed = JSON.parse((ltmItem!.content as { text: string }).text);
    expect(parsed.memories.some((m: { id: string }) => m.id === "mem-org-new")).toBe(true);
    expect(parsed.memories.some((m: { id: string }) => m.id === "mem-org-old")).toBe(false);
  });
});
