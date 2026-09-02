import { WorkflowState } from "./types";
import { GitHubClient } from "../integrations/github";
import { HumanAdapter } from "../adapters/humanAdapter";
import { getLLM } from "./llmFactory";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// ------------------------------------------------------------------
// SOLID Principle Refactoring:
// Interface Segregation & Dependency Inversion
// ------------------------------------------------------------------
export interface VersionControlClient {
  listRepositories(): Promise<Array<{ name: string }>>;
  createBranch(
    repo: string,
    branchName: string,
  ): Promise<{ branchName: string; success: boolean }>;
  createPullRequest(options: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base?: string;
  }): Promise<{ prId: number; url: string; state: string }>;
}

export interface CodeGenerator {
  generateCode(spec: string): Promise<string>;
}

// ------------------------------------------------------------------
// Single Responsibility Principle (SRP) & Open/Closed Principle (OCP)
// We isolate the LLM code generation into its own class implementing CodeGenerator.
// ------------------------------------------------------------------
export class LLMCodeGenerator implements CodeGenerator {
  async generateCode(spec: string): Promise<string> {
    const llm = getLLM();
    try {
      const response = await llm.invoke([
        new SystemMessage(
          "You are an expert software developer agent. Write the main code or an implementation plan for the requested feature based on the spec. Provide your response clearly formatted.",
        ),
        new HumanMessage(
          `Please implement this feature based on the following spec:\n\n${spec}`,
        ),
      ]);
      return response.content.toString();
    } catch (err: any) {
      console.warn("LLM generation failed", err);
      return "_LLM generation failed or was bypassed. Mock implementation._";
    }
  }
}

export class DeveloperAgent {
  private vcsClient: VersionControlClient;
  private codeGenerator: CodeGenerator;

  // Dependency Inversion Principle (DIP):
  // The agent depends on abstractions (VersionControlClient, CodeGenerator)
  // rather than concrete implementations. Default values are provided for backward compatibility.
  constructor(
    vcsClient?: VersionControlClient,
    codeGenerator?: CodeGenerator,
  ) {
    this.vcsClient = vcsClient || new GitHubClient();
    this.codeGenerator = codeGenerator || new LLMCodeGenerator();
  }

  // Single Responsibility Principle (SRP):
  // The run method now only coordinates the high-level workflow.
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
