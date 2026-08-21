import { WorkflowState } from './types';
import { BookStackClient } from '../integrations/bookstack';
import { AzureDevOpsClient } from '../integrations/azureDevOps';
import { HumanAdapter } from '../adapters/humanAdapter';

export class OrchestratorAgent {
  private bookStackClient: BookStackClient;
  private azureDevOpsClient: AzureDevOpsClient;

  constructor(bookStackClient?: BookStackClient, azureDevOpsClient?: AzureDevOpsClient) {
    this.bookStackClient = bookStackClient || new BookStackClient();
    this.azureDevOpsClient = azureDevOpsClient || new AzureDevOpsClient();
  }

  // Helper to evaluate document status
  evaluateInput(state: WorkflowState): { isDoc: boolean; isMatureDoc: boolean; reasons: string[] } {
    if (state.isMatureDoc || state.docContent) {
      return { isDoc: true, isMatureDoc: true, reasons: [] };
    }

    const prompt = state.inputPrompt.trim();
    const isDocCandidate = prompt.length > 50 || prompt.includes('#') || prompt.toLowerCase().includes('specification') || prompt.toLowerCase().includes('doc');

    const reasons: string[] = [];
    if (!isDocCandidate) {
      reasons.push('Input is too short or informal to be considered a software spec documentation.');
      return { isDoc: false, isMatureDoc: false, reasons };
    }

    const hasTechStack = /node|typescript|react|postgres|docker|api|jwt|database|schema/i.test(prompt);
    const hasArch = /architecture|component|endpoint|service|flow|module/i.test(prompt);
    const hasReqs = /requirement|feature|user story|acceptance/i.test(prompt);

    if (!hasTechStack) reasons.push('Missing explicit technology stack details.');
    if (!hasArch) reasons.push('Missing clear system architecture or API specifications.');
    if (!hasReqs) reasons.push('Missing structured feature requirements or acceptance criteria.');

    const isMatureDoc = hasTechStack && hasArch && hasReqs;
    return { isDoc: true, isMatureDoc, reasons };
  }

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify('OrchestratorAgent evaluating input, existing wiki docs, and repository code...');

    // Fetch context from BookStack and Azure DevOps
    const existingWikiPages = await this.bookStackClient.listPages();
    const existingRepos = await this.azureDevOpsClient.listRepositories();

    await humanAdapter.notify(`Found ${existingWikiPages.length} wiki docs and ${existingRepos.length} Azure DevOps repos for context.`);

    // Check input maturity
    const evalResult = this.evaluateInput(state);

    if (!evalResult.isDoc) {
      await humanAdapter.notify('OrchestratorAgent determined input is NOT a documentation. Handing off to DocGeneratorAgent.');
      return {
        isDoc: false,
        isMatureDoc: false,
        status: 'DOC_GENERATING',
      };
    }

    if (!evalResult.isMatureDoc) {
      await humanAdapter.notify('OrchestratorAgent determined document has technical ambiguities. Asking clarifying questions...');
      const answers: Record<string, string> = {};

      for (let i = 0; i < evalResult.reasons.length; i++) {
        const question = `Ambiguity Clarification #${i + 1}: ${evalResult.reasons[i]} Please clarify.`;
        const ans = await humanAdapter.askHuman(question, { existingRepos: existingRepos.map((r) => r.name) });
        answers[`q_${i}`] = ans;
      }

      await humanAdapter.notify('All ambiguities resolved with user input. Document is now mature.');
      return {
        isDoc: true,
        isMatureDoc: true,
        docContent: `${state.inputPrompt}\n\n## Clarifications & Ambiguity Resolution\n${Object.values(answers).join('\n')}`,
        status: 'READY_FOR_DEV',
      };
    }

    // Fully mature document -> create Azure DevOps tasks
    await humanAdapter.notify('OrchestratorAgent confirmed MATURE documentation with zero ambiguities. Creating Azure DevOps work items...');

    const tasks = [
      {
        title: `[Core Architecture] ${state.docTitle || 'System Component Setup'}`,
        description: `Implement base system module based on spec:\n${state.docContent || state.inputPrompt}`,
        type: 'Task' as const,
      },
      {
        title: `[API Integration] ${state.docTitle || 'API Services'}`,
        description: `Implement REST/GraphQL API contracts and database schema.`,
        type: 'User Story' as const,
      },
    ];

    const workItemIds: number[] = [];
    for (const task of tasks) {
      const item = await this.azureDevOpsClient.createWorkItem(task);
      if (item.id) workItemIds.push(item.id);
    }

    await humanAdapter.notify(`Created ${workItemIds.length} work items in Azure DevOps: ${workItemIds.join(', ')}`);

    return {
      isDoc: true,
      isMatureDoc: true,
      tasks,
      createdWorkItemIds: workItemIds,
      status: 'READY_FOR_DEV',
    };
  }
}
