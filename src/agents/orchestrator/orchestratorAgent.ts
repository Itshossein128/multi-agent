import { WorkflowState, Agent, ProjectMode, VcsMode } from "../core/types";
import { GitHubClient } from "../../integrations/github";
import { LocalGitClient } from "../../integrations/localGit";
import { HumanAdapter } from "../../adapters/humanAdapter";
import { IssueTrackerClient } from "./types";
import { DocumentEvaluator, LLMDocumentEvaluator } from "./documentEvaluator";
import { IntentClassifier, LLMIntentClassifier } from "./intentClassifier";

export class OrchestratorAgent implements Agent {
  private issueTracker: IssueTrackerClient;
  private evaluator: DocumentEvaluator;
  private intentClassifier: IntentClassifier;
  private localGit: LocalGitClient;

  constructor(
    issueTracker?: IssueTrackerClient,
    evaluator?: DocumentEvaluator,
    intentClassifier?: IntentClassifier,
    localGit?: LocalGitClient,
  ) {
    this.issueTracker = issueTracker || new GitHubClient();
    this.evaluator = evaluator || new LLMDocumentEvaluator();
    this.intentClassifier = intentClassifier || new LLMIntentClassifier();
    this.localGit = localGit || new LocalGitClient();
  }

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify("OrchestratorAgent evaluating input and repository context...");

    const repos = await this.issueTracker.listRepositories();
    const existingRepoNames = repos.map((r) => r.name);
    await humanAdapter.notify(`Found ${existingRepoNames.length} repos for context.`);

    // 1. Triage intent if mode is not yet established
    let projectMode: ProjectMode = state.projectMode || 'NEW_PROJECT';
    let targetRepo = state.targetRepo;
    let targetFile = state.targetFile;
    let existingCodeContext = state.existingCodeContext;

    if (!state.projectMode) {
      const intent = await this.intentClassifier.classify(state.inputPrompt, existingRepoNames);
      projectMode = intent.mode;
      if (!targetRepo && intent.targetRepo) targetRepo = intent.targetRepo;
      if (!targetFile && intent.targetFile) targetFile = intent.targetFile;
      await humanAdapter.notify(`OrchestratorAgent classified workflow as: [${projectMode}] mode.`);
    }

    // Guarantee targetRepo is resolved for continuation or debugging
    const activeRepo = targetRepo || existingRepoNames[0] || 'MainProject-Backend';

    // 2. Determine VCS Execution Mode (Clone vs API)
    let vcsMode: VcsMode = state.vcsMode || 'API';
    let workspacePath = state.workspacePath;

    if (!state.vcsMode) {
      const explicitClone = /\b(clone|download repo|locally|local repo)\b/i.test(state.inputPrompt);
      const explicitApi = /\b(api only|use api|via api|cloud api|no clone|dont clone)\b/i.test(state.inputPrompt);

      if (explicitClone) {
        vcsMode = 'CLONE';
        await humanAdapter.notify(`User requested local cloning in prompt. Operating in [CLONE] mode.`);
      } else if (explicitApi) {
        vcsMode = 'API';
        await humanAdapter.notify(`User requested API execution in prompt. Operating in [API] mode.`);
      } else {
        const choice = await humanAdapter.askHuman(
          `For repository "${activeRepo}", how would you like to operate?\n1. "clone": Clone repository locally to workspace and manage code with local Git.\n2. "api": Operate directly via GitHub Cloud APIs without local cloning.\n👉 Please reply with "clone" or "api".`,
          {
            repository: activeRepo,
            options: ['clone', 'api'],
          }
        );
        vcsMode = /\b(clone|local)\b/i.test(choice) ? 'CLONE' : 'API';
        await humanAdapter.notify(`Strategy selected: [${vcsMode}] for repository "${activeRepo}".`);
      }
    }

    if (vcsMode === 'CLONE') {
      try {
        await humanAdapter.notify(`OrchestratorAgent cloning repository "${activeRepo}" into local workspace...`);
        workspacePath = await this.localGit.cloneOrPull(activeRepo);
        await humanAdapter.notify(`Repository successfully cloned to workspace: "${workspacePath}".`);
      } catch (err: any) {
        console.warn(`Local clone failed: ${err.message}. Falling back to API mode.`);
        vcsMode = 'API';
      }
    } else {
      await humanAdapter.notify(`OrchestratorAgent operating directly via GitHub Cloud APIs (no local clone).`);
    }

    // -------------------------------------------------------------
    // BRANCH A: DEBUGGING EXISTING PROJECT
    // -------------------------------------------------------------
    if (projectMode === 'DEBUG') {
      await humanAdapter.notify(`OrchestratorAgent initiating bug triage in repository "${activeRepo}"...`);

      // Inspect repo files to locate target file if not known
      if (this.issueTracker.listRepositoryFiles && !targetFile) {
        try {
          const files = await this.issueTracker.listRepositoryFiles(activeRepo);
          const words = state.inputPrompt.toLowerCase().split(/[^a-z0-9_.-]+/);
          const matched = files.find(f => f.type === 'file' && words.includes(f.name.toLowerCase()));
          if (matched) {
            targetFile = matched.path;
          } else {
            const entry = files.find(f => f.name === 'index.js' || f.name === 'index.ts' || f.name === 'main.ts' || f.name === 'app.ts');
            if (entry) targetFile = entry.path;
          }
        } catch (err: any) {
          console.warn(`[OrchestratorAgent] Could not list repo files for debugging: ${err.message}`);
        }
      }

      // Fetch existing code context if targetFile is known
      if (this.issueTracker.getFileContent && targetFile && !existingCodeContext) {
        try {
          const content = await this.issueTracker.getFileContent(activeRepo, targetFile);
          if (content) existingCodeContext = content;
        } catch (err: any) {
          console.warn(`[OrchestratorAgent] Could not read file content for debugging: ${err.message}`);
        }
      }

      const bugTitle = `[Bug] ${state.docTitle || state.inputPrompt.slice(0, 60)}`;
      const bugDesc = `Bug Report & Investigation:\n\n${state.inputPrompt}\n\nAffected Target: ${targetFile || 'System Component'}`;
      const issue = await this.issueTracker.createIssue(activeRepo, bugTitle, bugDesc);
      const workItemId = issue.number || issue.id || 1;

      await humanAdapter.notify(`Created Bug issue #${workItemId} in "${activeRepo}". Routing directly to DeveloperAgent for fix.`);

      return {
        projectMode: 'DEBUG',
        vcsMode,
        workspacePath,
        isDoc: true,
        isMatureDoc: true,
        docTitle: bugTitle,
        docContent: `## Bug Diagnosis & Fix Plan\n\nIssue Description:\n${state.inputPrompt}\n\nTarget File: ${targetFile || 'Detected source'}\n\nExisting Code Snippet:\n\`\`\`\n${(existingCodeContext || '').slice(0, 1500)}\n\`\`\``,
        targetRepo: activeRepo,
        targetFile,
        existingCodeContext,
        createdWorkItemIds: [workItemId],
        tasks: [{ title: bugTitle, description: bugDesc, type: 'Bug' }],
        status: 'READY_FOR_DEV',
      };
    }

    // -------------------------------------------------------------
    // BRANCH B: CONTINUATION OF EXISTING PROJECT
    // -------------------------------------------------------------
    if (projectMode === 'CONTINUATION') {
      await humanAdapter.notify(`OrchestratorAgent inspecting existing repository "${activeRepo}" for continuation...`);

      // Read repository context if not already loaded
      if (this.issueTracker.listRepositoryFiles && !existingCodeContext) {
        try {
          const files = await this.issueTracker.listRepositoryFiles(activeRepo);
          const pkgFile = files.find(f => f.name === 'package.json');
          if (pkgFile && this.issueTracker.getFileContent) {
            const pkgContent = await this.issueTracker.getFileContent(activeRepo, 'package.json');
            if (pkgContent) existingCodeContext = `package.json:\n${pkgContent.slice(0, 1000)}`;
          }
        } catch (err: any) {
          console.warn(`[OrchestratorAgent] Could not read repo context: ${err.message}`);
        }
      }

      // If document is not mature and not from docGenerator, evaluate or generate
      if (!state.isDoc && !state.isMatureDoc) {
        const evalResult = await this.evaluator.evaluate(state.inputPrompt.trim());
        if (!evalResult.isDoc || !evalResult.isMatureDoc) {
          await humanAdapter.notify(`OrchestratorAgent: Handing off to DocGeneratorAgent for continuation specification.`);
          return {
            projectMode: 'CONTINUATION',
            vcsMode,
            workspacePath,
            targetRepo: activeRepo,
            targetFile,
            existingCodeContext,
            isDoc: false,
            isMatureDoc: false,
            docEvaluationReasons: evalResult.reasons,
            status: 'DOC_GENERATING',
          };
        }
      }

      // Create feature tasks on existing repository
      const featureTitle = `[Feature] ${state.docTitle || state.inputPrompt.slice(0, 50)}`;
      const issue = await this.issueTracker.createIssue(
        activeRepo,
        featureTitle,
        `Feature Specification:\n${state.docContent || state.inputPrompt}`
      );
      const workItemId = issue.number || issue.id || 1;

      await humanAdapter.notify(`Created Feature issue #${workItemId} in existing repo "${activeRepo}".`);

      return {
        projectMode: 'CONTINUATION',
        vcsMode,
        workspacePath,
        targetRepo: activeRepo,
        targetFile,
        existingCodeContext,
        isDoc: true,
        isMatureDoc: true,
        docTitle: state.docTitle || featureTitle,
        createdWorkItemIds: [workItemId],
        tasks: [{ title: featureTitle, description: state.docContent || state.inputPrompt, type: 'Task' }],
        status: 'READY_FOR_DEV',
      };
    }

    // -------------------------------------------------------------
    // BRANCH C: GREENFIELD / NEW PROJECT (From 0)
    // -------------------------------------------------------------
    let evalResult = { isDoc: state.isDoc, isMatureDoc: state.isMatureDoc, reasons: [] as string[] };
    if (!state.isMatureDoc && !state.docContent) {
      evalResult = await this.evaluator.evaluate(state.inputPrompt.trim());
    } else {
      evalResult.isDoc = true;
      evalResult.isMatureDoc = true;
    }

    if (!evalResult.isDoc) {
      await humanAdapter.notify("OrchestratorAgent determined input is NOT a documentation. Handing off to DocGeneratorAgent.");
      return {
        projectMode: 'NEW_PROJECT',
        vcsMode,
        workspacePath,
        isDoc: false,
        isMatureDoc: false,
        docEvaluationReasons: evalResult.reasons,
        status: "DOC_GENERATING",
      };
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
        projectMode: 'NEW_PROJECT',
        vcsMode,
        workspacePath,
        isDoc: true,
        isMatureDoc: true,
        docContent: `${state.inputPrompt}\n\n## Clarifications & Ambiguity Resolution\n${Object.values(answers).join("\n")}`,
        status: "READY_FOR_DEV",
      };
    }

    await humanAdapter.notify(`OrchestratorAgent confirmed MATURE documentation. Creating work items...`);

    // Check if user requested creating a new repository in prompt or documentation content
    const fullSpec = `${state.inputPrompt} ${state.docContent || ""}`;
    const wantsNewRepo = /create (a )?new repo(sitory)?|new repo(sitory)?/i.test(fullSpec);

    if (!targetRepo) {
      if (wantsNewRepo && this.issueTracker.createRepository) {
        const repoNameCandidate = (state.docTitle || "auth-service-demo")
          .toLowerCase()
          .replace(/technical-specification:|technical-spec:/i, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 30) || "service-module";
        
        try {
          await humanAdapter.notify(`OrchestratorAgent creating requested new repository "${repoNameCandidate}" on GitHub...`);
          const created = await this.issueTracker.createRepository(repoNameCandidate, `Generated for: ${state.docTitle || state.inputPrompt.slice(0, 50)}`);
          targetRepo = created.name;
          await humanAdapter.notify(`Created repository: ${targetRepo}`);
        } catch (err: any) {
          console.warn(`Could not create repo "${repoNameCandidate}", falling back to existing. (${err.message})`);
          targetRepo = existingRepoNames[0] || "MainProject-Backend";
        }
      } else {
        targetRepo = existingRepoNames[0] || "MainProject-Backend";
      }
    }

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
    for (const task of tasks) {
      const issue = await this.issueTracker.createIssue(targetRepo, task.title, task.description);
      if (issue.number || issue.id) workItemIds.push(issue.number || issue.id!);
    }

    await humanAdapter.notify(`Created ${workItemIds.length} work items/issues in repo "${targetRepo}": ${workItemIds.join(", ")}`);

    return {
      projectMode: 'NEW_PROJECT',
      vcsMode,
      workspacePath,
      isDoc: true,
      isMatureDoc: true,
      tasks,
      createdWorkItemIds: workItemIds,
      targetRepo,
      status: "READY_FOR_DEV",
    };
  }
}
