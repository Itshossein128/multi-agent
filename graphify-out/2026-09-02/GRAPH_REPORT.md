# Graph Report - multi-agent  (2026-09-02)

## Corpus Check
- 23 files · ~5,104 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 166 nodes · 275 edges · 12 communities (10 shown, 2 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Human Adapter & Interaction
- Dependencies & External Libraries
- TypeScript Build & File Exclusions
- Agent Orchestration & Implementations
- Integration Definitions & Interfaces
- Testing Framework & Tooling
- Package Configuration & Metadata
- BookStack Integration Client
- Azure DevOps Integration Client
- Docker Infrastructure & Services
- Multi-Agent Root Workspace

## God Nodes (most connected - your core abstractions)
1. `BookStackClient` - 19 edges
2. `HumanAdapter` - 15 edges
3. `GitHubClient` - 14 edges
4. `compilerOptions` - 12 edges
5. `WorkflowState` - 11 edges
6. `AgentGraphEngine` - 10 edges
7. `OrchestratorAgent` - 9 edges
8. `AzureDevOpsClient` - 8 edges
9. `CLIHumanAdapter` - 8 edges
10. `LangFuseTracer` - 8 edges

## Surprising Connections (you probably didn't know these)
- `DocGeneratorAgent` --references--> `BookStackClient`  [EXTRACTED]
  src/agents/docGeneratorAgent.ts → src/integrations/bookstack.ts
- `AgentGraphEngine` --references--> `LangFuseTracer`  [EXTRACTED]
  src/agents/graphEngine.ts → src/integrations/langfuse.ts
- `OrchestratorAgent` --references--> `BookStackClient`  [EXTRACTED]
  src/agents/orchestratorAgent.ts → src/integrations/bookstack.ts
- `WorkflowState` --references--> `HumanAdapter`  [EXTRACTED]
  src/agents/types.ts → src/adapters/humanAdapter.ts
- `DeveloperAgent` --references--> `GitHubClient`  [EXTRACTED]
  src/agents/developerAgent.ts → src/integrations/github.ts

## Import Cycles
- None detected.

## Communities (12 total, 2 thin omitted)

### Community 0 - "Human Adapter & Interaction"
Cohesion: 0.17
Nodes (7): CLIHumanAdapter, HumanAdapter, MattermostHumanAdapter, WorkflowAnnotation, getLLM(), WorkflowState, program

### Community 1 - "Dependencies & External Libraries"
Cohesion: 0.09
Nodes (23): axios, commander, dotenv, inquirer, @langchain/anthropic, @langchain/core, @langchain/google-genai, @langchain/langgraph (+15 more)

### Community 2 - "TypeScript Build & File Exclusions"
Cohesion: 0.10
Nodes (19): dist, node_modules, **/*.spec.ts, src/**/*, **/*.test.ts, compilerOptions, declaration, esModuleInterop (+11 more)

### Community 3 - "Agent Orchestration & Implementations"
Cohesion: 0.22
Nodes (5): DeveloperAgent, DocGeneratorAgent, AgentGraphEngine, OrchestratorAgent, GitHubClient

### Community 4 - "Integration Definitions & Interfaces"
Cohesion: 0.16
Nodes (8): BOOKSTACK_DEFINITIONS, BookStackConfig, BookStackEntityDefinition, GitHubConfig, GitHubIssue, GitHubRepository, LangFuseConfig, LangFuseTracer

### Community 5 - "Testing Framework & Tooling"
Cohesion: 0.13
Nodes (15): jest, devDependencies, jest, ts-jest, ts-node, @types/inquirer, @types/jest, @types/node (+7 more)

### Community 6 - "Package Configuration & Metadata"
Cohesion: 0.15
Nodes (12): bin, multi-agent, description, license, main, name, scripts, build (+4 more)

### Community 8 - "Azure DevOps Integration Client"
Cohesion: 0.18
Nodes (3): AzureDevOpsClient, AzureDevOpsConfig, WorkItem

### Community 9 - "Docker Infrastructure & Services"
Cohesion: 0.33
Nodes (7): BookStack Service, BookStack MariaDB Service, LangFuse Observability Service, LangFuse PostgreSQL Service, Mattermost Chat Service, Mattermost PostgreSQL Service, Multi-Agent Application

## Knowledge Gaps
- **56 isolated node(s):** `AzureDevOpsConfig`, `WorkItem`, `name`, `version`, `description` (+51 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Dependencies & External Libraries` to `Package Configuration & Metadata`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `BookStackClient` connect `BookStack Integration Client` to `Human Adapter & Interaction`, `Agent Orchestration & Implementations`, `Integration Definitions & Interfaces`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Testing Framework & Tooling` to `Package Configuration & Metadata`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `AzureDevOpsConfig`, `WorkItem`, `name` to the rest of the system?**
  _56 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dependencies & External Libraries` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `TypeScript Build & File Exclusions` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Testing Framework & Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._