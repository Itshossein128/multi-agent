import { StateGraph, START, END, MemorySaver, Annotation } from '@langchain/langgraph';
import { WorkflowState } from './types';
import { OrchestratorAgent } from './orchestratorAgent';
import { DocGeneratorAgent } from './docGeneratorAgent';
import { DeveloperAgent } from './developerAgent';
import { CLIHumanAdapter, HumanAdapter } from '../adapters/humanAdapter';
import { LangFuseTracer } from '../integrations/langfuse';

const WorkflowAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    value: (x, y) => (y ? x.concat(y) : x),
    default: () => [],
  }),
  inputPrompt: Annotation<string>({
    value: (x, y) => y ?? x,
    default: () => '',
  }),
  isDoc: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  isMatureDoc: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  docTitle: Annotation<string | undefined>({
    value: (x, y) => y ?? x,
  }),
  docContent: Annotation<string | undefined>({
    value: (x, y) => y ?? x,
  }),
  bookStackTargetType: Annotation<'shelf' | 'book' | 'chapter' | 'page' | undefined>({
    value: (x, y) => y ?? x,
  }),
  bookStackTargetId: Annotation<number | undefined>({
    value: (x, y) => y ?? x,
  }),
  createdDocUrl: Annotation<string | undefined>({
    value: (x, y) => y ?? x,
  }),
  tasks: Annotation<Array<{ title: string; description: string; type: 'Task' | 'User Story' }> | undefined>({
    value: (x, y) => y ?? x,
  }),
  createdWorkItemIds: Annotation<number[] | undefined>({
    value: (x, y) => y ?? x,
  }),
  prUrl: Annotation<string | undefined>({
    value: (x, y) => y ?? x,
  }),
  humanAdapter: Annotation<HumanAdapter | undefined>({
    value: (x, y) => y ?? x,
  }),
  status: Annotation<WorkflowState['status']>({
    value: (x, y) => y ?? x,
    default: () => 'PENDING',
  }),
  clarificationQuestions: Annotation<string[] | undefined>({
    value: (x, y) => y ?? x,
  }),
  humanAnswers: Annotation<Record<string, string> | undefined>({
    value: (x, y) => y ?? x,
  }),
});

export class AgentGraphEngine {
  private orchestrator: OrchestratorAgent;
  private docGenerator: DocGeneratorAgent;
  private developer: DeveloperAgent;
  private tracer: LangFuseTracer;
  private compiledGraph: any;

  constructor(options?: {
    orchestrator?: OrchestratorAgent;
    docGenerator?: DocGeneratorAgent;
    developer?: DeveloperAgent;
    tracer?: LangFuseTracer;
  }) {
    this.orchestrator = options?.orchestrator || new OrchestratorAgent();
    this.docGenerator = options?.docGenerator || new DocGeneratorAgent();
    this.developer = options?.developer || new DeveloperAgent();
    this.tracer = options?.tracer || new LangFuseTracer();

    this.compiledGraph = this.buildGraph();
  }

  private buildGraph() {
    const graphBuilder = new StateGraph(WorkflowAnnotation);

    // Node Definitions
    const graph = graphBuilder
      .addNode('orchestratorNode', async (state: typeof WorkflowAnnotation.State) => {
        const adapter = state.humanAdapter || new CLIHumanAdapter();
        const updates = await this.orchestrator.run(state as WorkflowState, adapter);
        await this.tracer.traceExecution('orchestratorNode', { input: state.inputPrompt }, updates);
        return updates;
      })
      .addNode('docGeneratorNode', async (state: typeof WorkflowAnnotation.State) => {
        const adapter = state.humanAdapter || new CLIHumanAdapter();
        const updates = await this.docGenerator.run(state as WorkflowState, adapter);
        await this.tracer.traceExecution('docGeneratorNode', { input: state.inputPrompt }, updates);
        return updates;
      })
      .addNode('developerNode', async (state: typeof WorkflowAnnotation.State) => {
        const adapter = state.humanAdapter || new CLIHumanAdapter();
        const updates = await this.developer.run(state as WorkflowState, adapter);
        await this.tracer.traceExecution('developerNode', { docTitle: state.docTitle }, updates);
        return updates;
      });

    // Edges
    graph.addEdge(START, 'orchestratorNode');

    graph.addConditionalEdges('orchestratorNode' as any, (state: typeof WorkflowAnnotation.State) => {
      if (!state.isDoc) {
        return 'docGeneratorNode';
      }
      return 'developerNode';
    });

    graph.addEdge('docGeneratorNode' as any, 'orchestratorNode' as any);
    graph.addEdge('developerNode' as any, END);

    const checkpointer = new MemorySaver();
    return graph.compile({ checkpointer });
  }

  async runWorkflow(initialState: { inputPrompt: string; humanAdapter?: HumanAdapter; threadId?: string }): Promise<WorkflowState> {
    const threadId = initialState.threadId || `thread-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    const initial = {
      messages: [],
      inputPrompt: initialState.inputPrompt,
      isDoc: false,
      isMatureDoc: false,
      humanAdapter: initialState.humanAdapter || new CLIHumanAdapter(),
      status: 'PENDING' as const,
    };

    const result = await this.compiledGraph.invoke(initial, config);
    return result as WorkflowState;
  }
}
