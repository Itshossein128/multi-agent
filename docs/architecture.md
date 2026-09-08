# Multi-Agent System Architecture

## Architecture Diagram

```
                         Next.js
                     Agent Workspace
                            │
               ┌────────────┴────────────┐
               │                         │
         Task Management            Graph Editor
         Agent Management           Run Control
               │                         │
               └────────────┬────────────┘
                            │
                            ▼
                   TypeScript Server
                            │
                       LangGraph
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
            Agents        Tools         LLMs
               │            │            │
               └────────────┼────────────┘
                            │
                            ▼
                        Langfuse
                     Observability
```

---

## Architecture Breakdown

### 1. Frontend: Next.js Agent Workspace (`apps/web`)
The primary interaction and visual orchestration layer built with **Next.js**, **React Flow**, **Zustand**, and **shadcn/ui**:

- **Task Management**:
  - Execution queue tracking with priorities (`high`, `medium`, `low`).
  - Active task status, cancellation, and inspection.
  - Completed task monitoring with filtering by time period (`today`, `week`, `month`).
  - Failed task alerts with error traces and retry actions.

- **Agent Management**:
  - Live agent status monitoring (`running`, `idle`, `error`).
  - Workload and active task display for each agent role (Orchestrator, Developer, Doc Generator, Evaluator).
  - Runtime telemetry (uptime, tokens used, cost per agent).

- **Graph Editor & Canvas**:
  - Interactive **React Flow** canvas rendering the state machine topology.
  - Node status visualization (active, processing, idle).
  - Visual edge routing and conditional branching (`!isMatureDoc`, `ready_for_dev`).

- **Run Control**:
  - Workflow execution triggers, task pausing, and step-by-step state inspection.

---

### 2. Backend: TypeScript Server (`apps/server`)
The execution and coordination backend hosting the orchestration engine:

- **`apps/server/langgraph/`**:
  - StateGraph definition, StateAnnotation schemas, memory checkpoints, and state reducers.
- **`apps/server/agents/`**:
  - Specialized autonomous agents:
    - **Orchestrator Agent**: Intent classification, document maturity evaluation, task decomposition.
    - **Developer Agent**: Code generation, repository manipulation, git branch/commit creation.
    - **Doc Generator Agent**: Technical specification generation and documentation sync.
- **`apps/server/tools/`**:
  - Version Control tools (GitHub API, Local Git).
  - Documentation tools (BookStack API).
  - Human-in-the-loop adapters (CLI, Webhook, Next.js UI).
- **`apps/server/workflows/`**:
  - End-to-end composite workflows and lifecycle pipelines.
- **`apps/server/api/`**:
  - REST & WebSocket communication bridges between the Next.js UI and the LangGraph runtime.

---

### 3. Orchestration & Intelligence Layer

- **LangGraph**:
  - Manages cyclical graph flow, human-in-the-loop checkpoints, and conditional branch routing.
- **Agents, Tools & LLMs**:
  - Pluggable LLM factory supporting OpenAI (`gpt-4o`, `gpt-4o-mini`), Google GenAI (`gemini-2.5-pro`), and Anthropic (`claude-3-7-sonnet`).
  - Extensible tool execution environment.

---

### 4. Observability: Langfuse
- Full trace capturing of graph node invocations, LLM token counts, latency, and cost calculations.
- Seamless integration via `langfuse` and `langfuse-langchain`.

---

## Directory Structure Mapping

```
multi-agent-system/
│
├── apps/
│   ├── web/                     # Next.js Agent Workspace (React Flow + Zustand + shadcn)
│   │   ├── src/app/             # Dashboard, routing, and canvas pages
│   │   ├── src/components/      # UI components, GraphFlow, StatCards, Queue, Agents
│   │   └── src/store/           # Zustand state store (agents, tasks, queue, metrics)
│   │
│   └── server/                  # Node.js / TypeScript execution backend
│       ├── langgraph/           # StateGraph definitions & checkpointers
│       ├── agents/              # Orchestrator, Developer, DocGenerator agents
│       ├── tools/               # VCS, BookStack, and Human adapter tools
│       ├── workflows/           # Pipeline definitions & orchestration routines
│       └── api/                 # REST & WebSocket endpoints for web clients
│
├── packages/
│   ├── ui/                      # Shared design system components
│   ├── types/                   # Shared TypeScript models & state interfaces
│   └── shared/                  # Shared utilities & configurations
│
├── infrastructure/
│   └── docker/                  # Dockerfiles & docker-compose configurations
│
└── docs/
    └── architecture.md          # Architecture blueprint & diagrams
```
