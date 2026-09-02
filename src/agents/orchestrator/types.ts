export interface IssueTrackerClient {
  listRepositories(): Promise<Array<{ name: string }>>;
  createIssue(repo: string, title: string, body: string): Promise<{ id?: number; number?: number }>;
}
