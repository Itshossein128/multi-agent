import { WorkflowState } from './types';
import { AzureDevOpsClient } from '../integrations/azureDevOps';
import { HumanAdapter } from '../adapters/humanAdapter';

export class DeveloperAgent {
  private azureDevOpsClient: AzureDevOpsClient;

  constructor(azureDevOpsClient?: AzureDevOpsClient) {
    this.azureDevOpsClient = azureDevOpsClient || new AzureDevOpsClient();
  }

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify('DeveloperAgent starting software development execution...');

    const repos = await this.azureDevOpsClient.listRepositories();
    const targetRepo = repos[0]?.name || 'PrimaryRepo';

    const branchName = `feature/agent-impl-${Date.now().toString().slice(-4)}`;
    await humanAdapter.notify(`DeveloperAgent creating branch "${branchName}" in repository "${targetRepo}"...`);
    await this.azureDevOpsClient.createBranch(targetRepo, branchName);

    const pr = await this.azureDevOpsClient.createPullRequest({
      repoName: targetRepo,
      sourceBranch: branchName,
      targetBranch: 'main',
      title: `[Auto-Dev] ${state.docTitle || 'Feature Implementation'}`,
      description: `Automated PR generated from mature technical spec.\n\nWork Items: ${(state.createdWorkItemIds || []).join(', ')}`,
    });

    await humanAdapter.notify(`DeveloperAgent created Azure DevOps Pull Request: ${pr.url}`);

    return {
      prUrl: pr.url,
      status: 'COMPLETED',
    };
  }
}
