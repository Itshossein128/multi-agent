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
