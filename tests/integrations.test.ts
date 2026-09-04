import { LangFuseTracer } from '../src/integrations/langfuse';
import { GitHubClient } from '../src/integrations/github';

describe('External Integration Clients', () => {  test('GitHubClient operations', async () => {
    const github = new GitHubClient();
    const issue = await github.createIssue('MainProject-Backend', 'Build GitHub API', 'Create GitHub REST endpoints');
    expect(issue.id).toBeDefined();
    expect(issue.title).toBe('Build GitHub API');

    const repos = await github.listRepositories();
    expect(repos.length).toBeGreaterThan(0);

    const newRepo = await github.createRepository('new-test-repo', 'Test repo description');
    expect(newRepo.name).toBe('new-test-repo');

    const branch = await github.createBranch('MainProject-Backend', 'feature/github-test');
    expect(branch.success).toBe(true);

    const fileCommit = await github.commitFile({
      repo: 'MainProject-Backend',
      path: 'src/index.ts',
      content: 'console.log("hello");',
      message: 'Initial test commit',
      branch: 'feature/github-test',
    });
    expect(fileCommit.success).toBe(true);

    const pr = await github.createPullRequest({
      repo: repos[0].name,
      head: 'feature/github-test',
      base: 'main',
      title: 'PR for GitHub',
      body: 'Adds GitHub features',
    });
    expect(pr.prId).toBeDefined();
    expect(pr.state).toBe('open');
  });

  test('LangFuseTracer trace execution', async () => {
    const tracer = new LangFuseTracer();
    const traceId = await tracer.traceExecution('test-step', { input: 'hello' }, { output: 'world' });
    expect(traceId).toBeDefined();
  });
});
