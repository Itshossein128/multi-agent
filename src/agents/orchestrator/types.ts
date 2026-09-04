export interface IssueTrackerClient {
  listRepositories(): Promise<Array<{ name: string }>>;
  createIssue(repo: string, title: string, body: string): Promise<{ id?: number; number?: number }>;
  createRepository?(name: string, description?: string): Promise<{ name: string }>;
  getFileContent?(repo: string, path: string, ref?: string): Promise<string | null>;
  listRepositoryFiles?(repo: string, path?: string, ref?: string): Promise<Array<{ name: string; path: string; type: 'file' | 'dir' }>>;
}
