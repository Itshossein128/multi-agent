import { WorkflowState, Agent } from "../core/types";
import { GitHubClient } from "../../integrations/github";
import { HumanAdapter } from "../../adapters/humanAdapter";
import { VersionControlClient } from "./types";
import { CodeGenerator, LLMCodeGenerator } from "./codeGenerator";

export class DeveloperAgent implements Agent {
  private vcsClient: VersionControlClient;
  private codeGenerator: CodeGenerator;

  constructor(
    vcsClient?: VersionControlClient,
    codeGenerator?: CodeGenerator,
  ) {
    this.vcsClient = vcsClient || new GitHubClient();
    this.codeGenerator = codeGenerator || new LLMCodeGenerator();
  }

  async run(
    state: WorkflowState,
    humanAdapter: HumanAdapter,
  ): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify(
      "DeveloperAgent starting software development execution with Code Generator...",
    );

    const repos = await this.vcsClient.listRepositories();
    const targetRepo = repos[0]?.name || "MainProject-Backend";

    const branchName = this.formatBranchName(state.docTitle || "feature-impl");

    await humanAdapter.notify(
      `DeveloperAgent is writing code based on documentation...`,
    );

    const docStr = state.docContent || state.inputPrompt;
    const generatedCode = await this.codeGenerator.generateCode(docStr);

    await humanAdapter.notify(
      `DeveloperAgent creating branch "${branchName}" in repository "${targetRepo}"...`,
    );

    await this.vcsClient.createBranch(targetRepo, branchName);

    const pr = await this.vcsClient.createPullRequest({
      repo: targetRepo,
      title: `[Auto-Dev] ${state.docTitle || "Feature Implementation"}`,
      body: `Automated PR generated from mature technical spec.\n\nIssues/Work Items: ${(
        state.createdWorkItemIds || []
      ).join(", ")}\n\n### Generated Implementation:\n\n${generatedCode}`,
      head: branchName,
      base: "main",
    });

    await humanAdapter.notify(
      `DeveloperAgent created version control Pull Request: ${pr.url}`,
    );

    return {
      prUrl: pr.url,
      status: "COMPLETED",
    };
  }

  private formatBranchName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }
}
