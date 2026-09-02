# Graph Report - multi-agent  (2026-09-02)

## Corpus Check
- 7 files · ~3,733 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 137 nodes · 210 edges · 11 communities (8 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Human Adapter & Interaction
- Dependencies & LLM Frameworks
- TypeScript Configuration & Build Paths
- Testing Framework & Type Definitions
- Package Metadata & Scripts
- Agent Orchestration & Graph Engine
- Integrations & Monitoring Config
- GitHub Client & Version Control
- Docker Services & Infrastructure
- Application Entry Point

## God Nodes (most connected - your core abstractions)
1. `HumanAdapter` - 12 edges
2. `GitHubClient` - 12 edges
3. `compilerOptions` - 12 edges
4. `AgentGraphEngine` - 10 edges
5. `WorkflowState` - 10 edges
6. `CLIHumanAdapter` - 8 edges
7. `LangFuseTracer` - 8 edges
8. `MattermostHumanAdapter` - 7 edges
9. `DeveloperAgent` - 7 edges
10. `OrchestratorAgent` - 7 edges

## Surprising Connections (you probably didn't know these)
- `DeveloperAgent` --references--> `GitHubClient`  [EXTRACTED]
  src/agents/developerAgent.ts → src/integrations/github.ts
- `AgentGraphEngine` --references--> `LangFuseTracer`  [EXTRACTED]
  src/agents/graphEngine.ts → src/integrations/langfuse.ts
- `AgentGraphEngine` --references--> `DeveloperAgent`  [EXTRACTED]
  src/agents/graphEngine.ts → src/agents/developerAgent.ts
- `AgentGraphEngine` --references--> `DocGeneratorAgent`  [EXTRACTED]
  src/agents/graphEngine.ts → src/agents/docGeneratorAgent.ts
- `AgentGraphEngine` --references--> `OrchestratorAgent`  [EXTRACTED]
  src/agents/graphEngine.ts → src/agents/orchestratorAgent.ts

## Import Cycles
- None detected.

## Communities (11 total, 2 thin omitted)

### Community 0 - "Human Adapter & Interaction"
Cohesion: 0.19
Nodes (7): CLIHumanAdapter, HumanAdapter, MattermostHumanAdapter, WorkflowAnnotation, getLLM(), WorkflowState, program

### Community 1 - "Dependencies & LLM Frameworks"
Cohesion: 0.09
Nodes (23): axios, commander, dotenv, inquirer, @langchain/anthropic, @langchain/core, @langchain/google-genai, @langchain/langgraph (+15 more)

### Community 2 - "TypeScript Configuration & Build Paths"
Cohesion: 0.10
Nodes (19): dist, node_modules, **/*.spec.ts, src/**/*, **/*.test.ts, compilerOptions, declaration, esModuleInterop (+11 more)

### Community 3 - "Testing Framework & Type Definitions"
Cohesion: 0.13
Nodes (15): jest, devDependencies, jest, ts-jest, ts-node, @types/inquirer, @types/jest, @types/node (+7 more)

### Community 4 - "Package Metadata & Scripts"
Cohesion: 0.15
Nodes (12): bin, multi-agent, description, license, main, name, scripts, build (+4 more)

### Community 5 - "Agent Orchestration & Graph Engine"
Cohesion: 0.24
Nodes (4): DeveloperAgent, DocGeneratorAgent, AgentGraphEngine, OrchestratorAgent

### Community 6 - "Integrations & Monitoring Config"
Cohesion: 0.20
Nodes (5): GitHubConfig, GitHubIssue, GitHubRepository, LangFuseConfig, LangFuseTracer

### Community 8 - "Docker Services & Infrastructure"
Cohesion: 0.40
Nodes (5): LangFuse Service, LangFuse DB Service, Mattermost Service, Mattermost DB Service, Multi-Agent Platform Service

## Knowledge Gaps
- **53 isolated node(s):** `GitHubConfig`, `GitHubIssue`, `GitHubRepository`, `LangFuseConfig`, `WorkflowAnnotation` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 66 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Dependencies & LLM Frameworks` to `Package Metadata & Scripts`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Testing Framework & Type Definitions` to `Package Metadata & Scripts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `GitHubClient` connect `GitHub Client & Version Control` to `Human Adapter & Interaction`, `Agent Orchestration & Graph Engine`, `Integrations & Monitoring Config`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `GitHubConfig`, `GitHubIssue`, `GitHubRepository` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dependencies & LLM Frameworks` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `TypeScript Configuration & Build Paths` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Testing Framework & Type Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._