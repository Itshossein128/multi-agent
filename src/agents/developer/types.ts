export interface VersionControlClient {
  listRepositories(): Promise<Array<{ name: string }>>;
  createBranch(
    repo: string,
    branchName: string,
  ): Promise<{ branchName: string; success: boolean }>;
  commitFile?(options: {
    repo: string;
    path: string;
    content: string;
    message: string;
    branch: string;
  }): Promise<{ success: boolean; sha?: string }>;
  getFileContent?(repo: string, path: string, ref?: string): Promise<string | null>;
  listRepositoryFiles?(repo: string, path?: string, ref?: string): Promise<Array<{ name: string; path: string; type: 'file' | 'dir' }>>;
  createPullRequest(options: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base?: string;
  }): Promise<{ prId: number; url: string; state: string }>;
}
