export interface AzureDevOpsConfig {
  orgUrl: string;
  project: string;
  pat: string;
}

export interface WorkItem {
  id?: number;
  title: string;
  description: string;
  type: 'Task' | 'User Story' | 'Bug' | 'Feature';
  assignedTo?: string;
  state?: string;
}

export class AzureDevOpsClient {
  private orgUrl: string;
  private project: string;
  private pat: string;

  constructor(config?: Partial<AzureDevOpsConfig>) {
    this.orgUrl = config?.orgUrl || process.env.AZURE_DEVOPS_ORG_URL || 'https://dev.azure.com/myorg';
    this.project = config?.project || process.env.AZURE_DEVOPS_PROJECT || 'MyProject';
    this.pat = config?.pat || process.env.AZURE_DEVOPS_PAT || 'mock-pat';
  }

  // Work Item Operations
  async createWorkItem(item: WorkItem): Promise<WorkItem> {
    console.log(`[AzureDevOps] Creating work item (${item.type}): "${item.title}"`);
    return {
      id: Math.floor(Math.random() * 10000) + 1,
      title: item.title,
      description: item.description,
      type: item.type,
      assignedTo: item.assignedTo || 'Developer Agent',
      state: 'New',
    };
  }

  async listWorkItems(): Promise<WorkItem[]> {
    return [
      {
        id: 101,
        title: 'Implement Core Authentication Module',
        description: 'Set up JWT and OAuth2 strategies.',
        type: 'Task',
        assignedTo: 'Developer Agent',
        state: 'Active',
      },
    ];
  }

  // Repository Operations
  async listRepositories(): Promise<Array<{ id: string; name: string; url: string }>> {
    return [
      {
        id: 'repo-001',
        name: `${this.project}-Backend`,
        url: `${this.orgUrl}/${this.project}/_git/${this.project}-Backend`,
      },
    ];
  }

  async getRepositoryCode(repoName: string, path: string = '/'): Promise<string> {
    console.log(`[AzureDevOps] Fetching code for repo ${repoName} path ${path}`);
    return `// Code content for ${path} in ${repoName}\nexport const version = "1.0.0";`;
  }

  async createBranch(repoName: string, branchName: string, sourceRef: string = 'main'): Promise<{ branchName: string; success: boolean }> {
    console.log(`[AzureDevOps] Creating branch "${branchName}" from "${sourceRef}" in repo ${repoName}`);
    return { branchName, success: true };
  }

  async createPullRequest(options: {
    repoName: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
  }): Promise<{ prId: number; url: string; status: string }> {
    console.log(`[AzureDevOps] Creating PR in ${options.repoName}: "${options.title}" (${options.sourceBranch} -> ${options.targetBranch})`);
    const prId = Math.floor(Math.random() * 500) + 100;
    return {
      prId,
      url: `${this.orgUrl}/${this.project}/_git/${options.repoName}/pullrequest/${prId}`,
      status: 'active',
    };
  }
}
