import { AgentGraphEngine } from '../src/agents/graphEngine';
import { CLIHumanAdapter } from '../src/adapters/humanAdapter';
import { getLLM } from '../src/agents/llmFactory';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

describe('Multi-Agent Graph Engine & LLM Factory', () => {
  beforeEach(() => {
    process.env.AUTO_ANSWER = 'Sample user response for spec clarification';
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
    expect(result.bookStackTargetType).toBeDefined();
    expect(result.createdWorkItemIds?.length).toBeGreaterThan(0);
    expect(result.prUrl).toBeDefined();
    expect(result.status).toBe('COMPLETED');
  });
});

