import { WorkflowState } from "./types";
import { GitHubClient } from "../integrations/github";
import { HumanAdapter } from "../adapters/humanAdapter";
import { getLLM } from "./llmFactory";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export class OrchestratorAgent {
  private githubClient: GitHubClient;

  constructor(githubClient?: GitHubClient) {
    this.githubClient = githubClient || new GitHubClient();
  }

  // Helper to evaluate document status
  async evaluateInput(
    state: WorkflowState,
  ): Promise<{ isDoc: boolean; isMatureDoc: boolean; reasons: string[] }> {
    if (state.isMatureDoc || state.docContent) {
      return { isDoc: true, isMatureDoc: true, reasons: [] };
    }

    const prompt = state.inputPrompt.trim();
    const isDocCandidate =
      prompt.length > 50 ||
      prompt.includes("#") ||
      prompt.toLowerCase().includes("specification") ||
      prompt.toLowerCase().includes("doc");

    const reasons: string[] = [];
    if (!isDocCandidate) {
      reasons.push(
        "Input is too short or informal to be considered a software spec documentation.",
      );
      return { isDoc: false, isMatureDoc: false, reasons };
    }

    const llm = getLLM();
    const evaluationPrompt = `
You are an expert technical architect. Evaluate the following software requirement prompt.
Does it contain mature, sufficient details regarding:
1. Technology Stack
2. System Architecture / Components
3. Feature / User Requirements

Respond with a JSON object ONLY, in this exact format:
{
  "isMatureDoc": boolean,
  "reasons": [] // If not mature, list specifically what is missing as short sentences. If mature, empty array.
}

Prompt to evaluate:
---
${prompt}
---`;

    try {
      const response = await llm.invoke([
        new SystemMessage("You are a technical document maturity analyzer."),
        new HumanMessage(evaluationPrompt),
      ]);

      const text = response.content
        .toString()
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const parsed = JSON.parse(text);

      return {
        isDoc: true,
        isMatureDoc: Boolean(parsed.isMatureDoc),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      };
    } catch (error) {
      console.warn(
        "LLM document maturity evaluation failed, falling back to assuming immature.",
        error,
      );
      return {
        isDoc: true,
        isMatureDoc: false,
        reasons: [
          "Document evaluation failed, system assumes missing details.",
        ],
      };
    }
  }

  async run(
    state: WorkflowState,
    humanAdapter: HumanAdapter,
  ): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify(
      "OrchestratorAgent evaluating input, existing wiki docs, and repository code...",
    );

    // Fetch context from DevOps Provider
    let existingRepoNames: string[] = [];
    const githubRepos = await this.githubClient.listRepositories();
    existingRepoNames = githubRepos.map((r) => r.name);

    await humanAdapter.notify(
      `Found ${existingRepoNames.length} repos in github for context.`,
    );

    // Check input maturity
    const evalResult = await this.evaluateInput(state);

    if (!evalResult.isDoc) {
      await humanAdapter.notify(
        "OrchestratorAgent determined input is NOT a documentation. Handing off to DocGeneratorAgent.",
      );
      return {
        isDoc: false,
        isMatureDoc: false,
        status: "DOC_GENERATING",
      };
    }

    if (!evalResult.isMatureDoc) {
      await humanAdapter.notify(
        "OrchestratorAgent determined document has technical ambiguities. Asking clarifying questions...",
      );
      const answers: Record<string, string> = {};

      for (let i = 0; i < evalResult.reasons.length; i++) {
        const question = `Ambiguity Clarification #${i + 1}: ${evalResult.reasons[i]} Please clarify.`;
        const ans = await humanAdapter.askHuman(question, {
          existingRepos: existingRepoNames,
        });
        answers[`q_${i}`] = ans;
      }

      await humanAdapter.notify(
        "All ambiguities resolved with user input. Document is now mature.",
      );
      return {
        isDoc: true,
        isMatureDoc: true,
        docContent: `${state.inputPrompt}\n\n## Clarifications & Ambiguity Resolution\n${Object.values(answers).join("\n")}`,
        status: "READY_FOR_DEV",
      };
    }

    // Fully mature document -> create work items / issues in DevOps provider
    await humanAdapter.notify(
      `OrchestratorAgent confirmed MATURE documentation. Creating work items in github...`,
    );

    const tasks = [
      {
        title: `[Core Architecture] ${state.docTitle || "System Component Setup"}`,
        description: `Implement base system module based on spec:\n${state.docContent || state.inputPrompt}`,
        type: "Task" as const,
      },
      {
        title: `[API Integration] ${state.docTitle || "API Services"}`,
        description: `Implement REST/GraphQL API contracts and database schema.`,
        type: "User Story" as const,
      },
    ];

    const workItemIds: number[] = [];
    const targetRepo = existingRepoNames[0] || "MainProject-Backend";
    for (const task of tasks) {
      const issue = await this.githubClient.createIssue(
        targetRepo,
        task.title,
        task.description,
      );
      if (issue.number || issue.id) workItemIds.push(issue.number || issue.id!);
    }

    await humanAdapter.notify(
      `Created ${workItemIds.length} work items/issues in github: ${workItemIds.join(", ")}`,
    );

    return {
      isDoc: true,
      isMatureDoc: true,
      tasks,
      createdWorkItemIds: workItemIds,
      status: "READY_FOR_DEV",
    };
  }
}
