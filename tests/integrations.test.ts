import { BookStackClient, BOOKSTACK_DEFINITIONS } from '../src/integrations/bookstack';
import { AzureDevOpsClient } from '../src/integrations/azureDevOps';
import { LangFuseTracer } from '../src/integrations/langfuse';

describe('External Integration Clients', () => {
  test('BookStackClient operations and definitions', async () => {
    const client = new BookStackClient();
    const defs = client.getDefinitions();
    expect(defs.shelf).toBeDefined();
    expect(defs.book).toBeDefined();
    expect(defs.chapter).toBeDefined();
    expect(defs.page).toBeDefined();

    const shelf = await client.createShelf('Test Shelf', 'Description');
    expect(shelf.name).toBe('Test Shelf');

    const book = await client.createBook('Test Book', 'Description');
    expect(book.name).toBe('Test Book');

    const chapter = await client.createChapter(book.id, 'Test Chapter', 'Description');
    expect(chapter.name).toBe('Test Chapter');

    const page = await client.createPage({ bookId: book.id, name: 'Test Page', markdown: '# Spec' });
    expect(page.name).toBe('Test Page');
  });

  test('AzureDevOpsClient operations', async () => {
    const ado = new AzureDevOpsClient();
    const wi = await ado.createWorkItem({ title: 'Build API', description: 'Build REST endpoints', type: 'Task' });
    expect(wi.id).toBeDefined();
    expect(wi.title).toBe('Build API');

    const repos = await ado.listRepositories();
    expect(repos.length).toBeGreaterThan(0);

    const pr = await ado.createPullRequest({
      repoName: repos[0].name,
      sourceBranch: 'feature/auth',
      targetBranch: 'main',
      title: 'PR for Auth',
      description: 'Adds auth features',
    });
    expect(pr.prId).toBeDefined();
    expect(pr.status).toBe('active');
  });

  test('LangFuseTracer trace execution', async () => {
    const tracer = new LangFuseTracer();
    const traceId = await tracer.traceExecution('test-step', { input: 'hello' }, { output: 'world' });
    expect(traceId).toBeDefined();
  });
});
