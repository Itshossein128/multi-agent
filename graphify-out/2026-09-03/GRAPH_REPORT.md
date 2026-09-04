# Graph Report - multi-agent  (2026-09-03)

## Corpus Check
- 33 files · ~8,152 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 217 nodes · 365 edges · 16 communities (12 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `39ffa1c0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- graphEngine.ts
- dependencies
- TypeScript Configuration & Build Paths
- devDependencies
- package.json
- llmFactory.ts
- GitHubClient
- MattermostHumanAdapter
- LangFuse Service
- multi-agent
- developerAgent.ts
- orchestratorAgent.ts
- Q: Explain GitHubClient
- rules/graphify.md
- workflows/graphify.md

## God Nodes (most connected - your core abstractions)
1. `HumanAdapter` - 16 edges
2. `GitHubClient` - 14 edges
3. `compilerOptions` - 12 edges
4. `MattermostHumanAdapter` - 11 edges
5. `getLLM()` - 11 edges
6. `Agent` - 11 edges
7. `WorkflowState` - 10 edges
8. `VersionControlClient` - 10 edges
9. `IssueTrackerClient` - 9 edges
10. `CLIHumanAdapter` - 8 edges

## Surprising Connections (you probably didn't know these)
- `GenerateCodeOptions` --references--> `ProjectMode`  [EXTRACTED]
  src/agents/developer/codeGenerator.ts → src/agents/core/types.ts
- `ClassifiedIntent` --references--> `ProjectMode`  [EXTRACTED]
  src/agents/orchestrator/intentClassifier.ts → src/agents/core/types.ts
- `DeveloperAgent` --implements--> `Agent`  [EXTRACTED]
  src/agents/developer/developerAgent.ts → src/agents/core/types.ts
- `OrchestratorAgent` --implements--> `Agent`  [EXTRACTED]
  src/agents/orchestrator/orchestratorAgent.ts → src/agents/core/types.ts
- `WorkflowState` --references--> `HumanAdapter`  [EXTRACTED]
  src/agents/core/types.ts → src/adapters/humanAdapter.ts

## Import Cycles
- None detected.

## Communities (16 total, 4 thin omitted)

### Community 0 - "graphEngine.ts"
Cohesion: 0.12
Nodes (12): CLIHumanAdapter, HumanAdapter, MattermostAdapterConfig, AgentGraphEngine, Tracer, WorkflowAnnotation, Agent, WorkflowState (+4 more)

### Community 1 - "dependencies"
Cohesion: 0.08
Nodes (25): axios, commander, dotenv, inquirer, @langchain/anthropic, @langchain/core, @langchain/google-genai, @langchain/langgraph (+17 more)

### Community 2 - "TypeScript Configuration & Build Paths"
Cohesion: 0.10
Nodes (19): dist, node_modules, **/*.spec.ts, src/**/*, **/*.test.ts, compilerOptions, declaration, esModuleInterop (+11 more)

### Community 3 - "devDependencies"
Cohesion: 0.13
Nodes (15): jest, devDependencies, jest, ts-jest, ts-node, @types/inquirer, @types/jest, @types/node (+7 more)

### Community 4 - "package.json"
Cohesion: 0.15
Nodes (12): bin, multi-agent, description, license, main, name, scripts, build (+4 more)

### Community 5 - "llmFactory.ts"
Cohesion: 0.20
Nodes (6): AnthropicProvider, defaultFactory, GoogleProvider, LLMFactory, LLMProvider, OpenAIProvider

### Community 6 - "GitHubClient"
Cohesion: 0.12
Nodes (6): GitHubClient, GitHubConfig, GitHubIssue, GitHubRepository, LangFuseConfig, LangFuseTracer

### Community 8 - "LangFuse Service"
Cohesion: 0.40
Nodes (5): LangFuse Service, LangFuse DB Service, Mattermost Service, Mattermost DB Service, Multi-Agent Platform Service

### Community 11 - "developerAgent.ts"
Cohesion: 0.20
Nodes (4): CodeGenerator, LLMCodeGenerator, DeveloperAgent, VersionControlClient

### Community 12 - "orchestratorAgent.ts"
Cohesion: 0.14
Nodes (10): getLLM(), ProjectMode, GenerateCodeOptions, DocumentEvaluator, LLMDocumentEvaluator, ClassifiedIntent, IntentClassifier, LLMIntentClassifier (+2 more)

### Community 13 - "Q: Explain GitHubClient"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Explain GitHubClient, Source Nodes

## Knowledge Gaps
- **61 isolated node(s):** `name`, `version`, `description`, `main`, `multi-agent` (+56 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HumanAdapter` connect `graphEngine.ts` to `developerAgent.ts`, `orchestratorAgent.ts`, `MattermostHumanAdapter`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `GitHubClient` connect `GitHubClient` to `developerAgent.ts`, `orchestratorAgent.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _61 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `graphEngine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `TypeScript Configuration & Build Paths` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._