import { AgentGraphEngine } from '../src/agents/core/graphEngine';
import { CLIHumanAdapter } from '../src/adapters/humanAdapter';
import { getLLM } from '../src/agents/core/llmFactory';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

describe('Multi-Agent Graph Engine & LLM Factory', () => {
  jest.setTimeout(30000);

  beforeEach(() => {
    process.env.AUTO_ANSWER = 'Sample user response for spec clarification';
    // Exercise the production fallback paths without depending on public API latency.
    process.env.LLM_PROVIDER = 'offline-test';
  });

  afterEach(() => {
    delete process.env.AUTO_ANSWER;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
  });

  test('LLM Factory returns ChatGoogleGenerativeAI when provider is gemini', () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const llm = getLLM();
    expect(llm).toBeInstanceOf(ChatGoogleGenerativeAI);
  });

  test('Flow 1: Mature document input directly creates work items and triggers developer agent', async () => {
    const engine = new AgentGraphEngine();
    const adapter = new CLIHumanAdapter();

    const matureDocPrompt = `
    # Technical Specification: User Auth Module

    ## Technology Stack
    Node.js, TypeScript, Express, PostgreSQL, Docker, JWT API tokens.

    ## Architecture
    REST API endpoints with OAuth2 authentication strategy and PostgreSQL DB schema.

    ## Requirements & Acceptance Criteria
    - Acceptance Criteria: JWT sign-in and sign-up endpoints working.
    - User Story: As a user, I can log in and view my profile.
    `;

    const result = await engine.runWorkflow({
      inputPrompt: matureDocPrompt,
      humanAdapter: adapter,
      threadId: 'test-thread-1',
    });

    expect(result.isDoc).toBe(true);
    expect(result.isMatureDoc).toBe(true);
    expect(result.createdWorkItemIds?.length).toBeGreaterThan(0);
    expect(result.prUrl).toBeDefined();
    expect(result.status).toBe('COMPLETED');
  });

  test('Flow 2: Amateur prompt routes to DocGeneratorAgent, matures doc, then creates work items & PR', async () => {
    const engine = new AgentGraphEngine();
    const adapter = new CLIHumanAdapter();

    const rawPrompt = 'build a simple chat app for our team';

    const result = await engine.runWorkflow({
      inputPrompt: rawPrompt,
      humanAdapter: adapter,
      threadId: 'test-thread-2',
    });

    expect(result.isDoc).toBe(true);
    expect(result.isMatureDoc).toBe(true);
    expect(result.createdWorkItemIds?.length).toBeGreaterThan(0);
    expect(result.prUrl).toBeDefined();
    expect(result.status).toBe('COMPLETED');
  });

  test('Flow 3: Debugging an existing project routes to DEBUG triage and creates fix PR', async () => {
    const engine = new AgentGraphEngine();
    const adapter = new CLIHumanAdapter();

    const debugPrompt = 'Fix the critical bug in index.js causing 500 error when parsing empty tokens';

    const result = await engine.runWorkflow({
      inputPrompt: debugPrompt,
      humanAdapter: adapter,
      threadId: 'test-thread-debug',
    });

    expect(result.projectMode).toBe('DEBUG');
    expect(result.tasks?.[0].type).toBe('Bug');
    expect(result.createdWorkItemIds?.length).toBeGreaterThan(0);
    expect(result.prUrl).toBeDefined();
    expect(result.status).toBe('COMPLETED');
  });

  test('Flow 4: Continuing an existing project routes to CONTINUATION and creates feature PR', async () => {
    const engine = new AgentGraphEngine();
    const adapter = new CLIHumanAdapter();

    const continuePrompt = 'In MainProject-Backend, continue implementing payment webhook endpoints with signature validation';

    const result = await engine.runWorkflow({
      inputPrompt: continuePrompt,
      humanAdapter: adapter,
      threadId: 'test-thread-continue',
    });

    expect(result.projectMode).toBe('CONTINUATION');
    expect(result.targetRepo).toBe('MainProject-Backend');
    expect(result.createdWorkItemIds?.length).toBeGreaterThan(0);
    expect(result.prUrl).toBeDefined();
    expect(result.status).toBe('COMPLETED');
  });

  test('Flow 5: When user orders to clone, workflow clones locally and uses Local Git CLI', async () => {
    const engine = new AgentGraphEngine();
    const adapter = new CLIHumanAdapter();

    const clonePrompt = 'Please clone the repository MainProject-Backend and implement health check endpoint';

    const result = await engine.runWorkflow({
      inputPrompt: clonePrompt,
      humanAdapter: adapter,
      threadId: 'test-thread-clone',
    });

    expect(result.vcsMode).toBe('CLONE');
    expect(result.workspacePath).toBeDefined();
    expect(result.createdWorkItemIds?.length).toBeGreaterThan(0);
    expect(result.prUrl).toBeDefined();
    expect(result.status).toBe('COMPLETED');
  });
});

