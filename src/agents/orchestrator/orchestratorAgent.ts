import { WorkflowState, Agent } from "../core/types";
import { GitHubClient } from "../../integrations/github";
import { HumanAdapter } from "../../adapters/humanAdapter";
import { IssueTrackerClient } from "./types";
import { DocumentEvaluator, LLMDocumentEvaluator } from "./documentEvaluator";

export class OrchestratorAgent implements Agent {
  private issueTracker: IssueTrackerClient;
  private evaluator: DocumentEvaluator;

  constructor(issueTracker?: IssueTrackerClient, evaluator?: DocumentEvaluator) {
    this.issueTracker = issueTracker || new GitHubClient();
    this.evaluator = evaluator || new LLMDocumentEvaluator();
  }

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify("OrchestratorAgent evaluating input and repository code...");

    let existingRepoNames: string[] = [];
    const repos = await this.issueTracker.listRepositories();
    existingRepoNames = repos.map((r) => r.name);

    await humanAdapter.notify(`Found ${existingRepoNames.length} repos for context.`);

    let evalResult = { isDoc: state.isDoc, isMatureDoc: state.isMatureDoc, reasons: [] as string[] };
    if (!state.isMatureDoc && !state.docContent) {
      evalResult = await this.evaluator.evaluate(state.inputPrompt.trim());
    } else {
      evalResult.isDoc = true;
      evalResult.isMatureDoc = true;
    }

    if (!evalResult.isDoc) {
      await humanAdapter.notify("OrchestratorAgent determined input is NOT a documentation. Handing off to DocGeneratorAgent.");
      return { isDoc: false, isMatureDoc: false, status: "DOC_GENERATING" };
    }

    if (!evalResult.isMatureDoc) {
      await humanAdapter.notify("OrchestratorAgent determined document has technical ambiguities. Asking clarifying questions...");
      const answers: Record<string, string> = {};

      for (let i = 0; i < evalResult.reasons.length; i++) {
        const question = `Ambiguity Clarification #${i + 1}: ${evalResult.reasons[i]} Please clarify.`;
        answers[`q_${i}`] = await humanAdapter.askHuman(question, { existingRepos: existingRepoNames });
      }

      await humanAdapter.notify("All ambiguities resolved with user input. Document is now mature.");
      return {
        isDoc: true,
        isMatureDoc: true,
        docContent: `${state.inputPrompt}\n\n## Clarifications & Ambiguity Resolution\n${Object.values(answers).join("\n")}`,
        status: "READY_FOR_DEV",
      };
    }

    await humanAdapter.notify(`OrchestratorAgent confirmed MATURE documentation. Creating work items...`);

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
      const issue = await this.issueTracker.createIssue(targetRepo, task.title, task.description);
      if (issue.number || issue.id) workItemIds.push(issue.number || issue.id!);
    }

    await humanAdapter.notify(`Created ${workItemIds.length} work items/issues: ${workItemIds.join(", ")}`);

    return {
      isDoc: true,
      isMatureDoc: true,
      tasks,
      createdWorkItemIds: workItemIds,
      status: "READY_FOR_DEV",
    };
  }
}
