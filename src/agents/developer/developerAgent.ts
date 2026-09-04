import { WorkflowState, Agent } from "../core/types";
import { GitHubClient } from "../../integrations/github";
import { LocalGitClient } from "../../integrations/localGit";
import { HumanAdapter } from "../../adapters/humanAdapter";
import { VersionControlClient } from "./types";
import { CodeGenerator, LLMCodeGenerator } from "./codeGenerator";

export class DeveloperAgent implements Agent {
  private vcsClient: VersionControlClient;
  private localGitClient: VersionControlClient;
  private codeGenerator: CodeGenerator;

  constructor(
    vcsClient?: VersionControlClient,
    codeGenerator?: CodeGenerator,
    localGitClient?: VersionControlClient,
  ) {
    this.vcsClient = vcsClient || new GitHubClient();
    this.codeGenerator = codeGenerator || new LLMCodeGenerator();
    this.localGitClient = localGitClient || new LocalGitClient();
  }

  async run(
    state: WorkflowState,
    humanAdapter: HumanAdapter,
  ): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify(
      "DeveloperAgent starting software development execution with Code Generator...",
    );

    const activeVcs =
      state.vcsMode === "CLONE" && this.localGitClient
        ? this.localGitClient
        : this.vcsClient;
    const vcsDescription =
      state.vcsMode === "CLONE" ? "Local Git Clone" : "GitHub Cloud API";

    const mode = state.projectMode || "NEW_PROJECT";
    const repos = await activeVcs.listRepositories();
    const targetRepo = state.targetRepo || repos[0]?.name || "MainProject-Backend";

    await humanAdapter.notify(
      `DeveloperAgent mode: "${mode}" using [${vcsDescription}] for repository "${targetRepo}".`,
    );

    // Determine target file path dynamically based on state, repo inspection, and mode
    let filePath = state.targetFile;
    if (!filePath) {
      if (activeVcs.listRepositoryFiles) {
        try {
          const files = await activeVcs.listRepositoryFiles(targetRepo);
          const candidate = files.find(
            (f) => f.type === "file" && (f.name.endsWith(".ts") || f.name.endsWith(".js")),
          );
          if (candidate) {
            filePath = mode === "DEBUG" ? candidate.path : `src/${candidate.name}`;
          }
        } catch {
          // ignore
        }
      }
    }
    if (!filePath) {
      const slug = this.formatBranchName(state.docTitle || "feature").slice(0, 20);
      filePath = mode === "DEBUG" ? "src/index.ts" : `src/${slug || "module"}.ts`;
    }

    const branchPrefix = mode === "DEBUG" ? "fix" : mode === "CONTINUATION" ? "feat" : "feature";
    const branchName = `${branchPrefix}/${this.formatBranchName(state.docTitle || "code-changes")}`;

    await humanAdapter.notify(
      `DeveloperAgent is writing code for "${filePath}" based on ${mode} specification...`,
    );

    const docStr = state.docContent || state.inputPrompt;
    const generatedCode = await this.codeGenerator.generateCode({
      spec: docStr,
      mode,
      targetFile: filePath,
      existingCode: state.existingCodeContext,
    });

    await humanAdapter.notify(
      `DeveloperAgent creating branch "${branchName}" in repository "${targetRepo}"...`,
    );

    await activeVcs.createBranch(targetRepo, branchName);

    // Commit generated/modified code file to the branch
    if (activeVcs.commitFile) {
      const commitMsg =
        mode === "DEBUG"
          ? `fix: resolve bug in ${filePath}`
          : mode === "CONTINUATION"
          ? `feat: extend ${filePath}`
          : `feat: implement ${state.docTitle || filePath}`;

      await humanAdapter.notify(
        `DeveloperAgent committing changes to "${filePath}" on branch "${branchName}"...`,
      );
      await activeVcs.commitFile({
        repo: targetRepo,
        path: filePath,
        content: generatedCode,
        message: commitMsg,
        branch: branchName,
      });
    }

    const prPrefix = mode === "DEBUG" ? "[Bugfix]" : mode === "CONTINUATION" ? "[Feature]" : "[Auto-Dev]";
    const prTitle = `${prPrefix} ${state.docTitle || "Code Implementation"}`;
    const prBody = `Automated ${mode} PR.\n\nIssues/Work Items: ${(
      state.createdWorkItemIds || []
    ).join(", ")}\n\n### Changes Summary & Spec:\n${docStr}\n\n### Implementation (${filePath}):\n\`\`\`typescript\n${generatedCode}\n\`\`\``;

    const pr = await activeVcs.createPullRequest({
      repo: targetRepo,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: "main",
    });

    await humanAdapter.notify(
      `DeveloperAgent created version control Pull Request: ${pr.url}`,
    );

    return {
      targetRepo,
      targetFile: filePath,
      vcsMode: state.vcsMode,
      workspacePath: state.workspacePath,
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
