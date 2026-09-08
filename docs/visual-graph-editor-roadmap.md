# Multi-Agent Studio Roadmap

This document defines the implementation roadmap for the **Multi-Agent Studio**.

The goal of the Studio is to provide a web-based control plane and visual programming environment for designing, configuring, running, and observing multi-agent systems powered by LangGraph.

The Studio is not only a dashboard and not only a graph viewer. It is intended to become the main interface through which a user can:

- create and configure agents,
- create and assign tasks,
- visually design multi-agent workflows,
- execute those workflows,
- inspect execution in real time,
- interact with human-in-the-loop steps,
- manage tools and memory,
- inspect traces, errors, latency, and cost.

The high-level architecture is:

```text
Multi-Agent Studio (Web)
        ↓
Backend API / Runtime
        ↓
Workflow Definition
        ↓
LangGraph Builder / Compiler
        ↓
LangGraph Runtime
        ↓
Agents / Tools / Memory / LLMs
        ↓
Execution Events / Traces / Results
```

The web application is the **control plane**. LangGraph is the **execution engine**. The graph/workflow definition is the **source of truth for workflow structure**.

---

# Progress

- [x] Phase 1 — Dashboard
- [x] Phase 2 — Task Board
- [x] Phase 3 — Visual Graph Editor
- [x] Phase 4 — Execution Timeline & Live Execution
- [x] Phase 5 — Agent Management & Configuration
- [ ] Phase 6 — Tool Management
- [ ] Phase 7 — Human-in-the-Loop & Approval System
- [ ] Phase 8 — Memory Management & Memory Explorer
- [ ] Phase 9 — Persistence, Runs, History & Recovery
- [ ] Phase 10 — Observability & Langfuse Integration
- [ ] Phase 11 — Validation, Safety & Runtime Guardrails
- [ ] Phase 12 — Production Hardening & Developer Experience

---

# Phase 1 — Dashboard ✅

## Goal

Create the main operational overview of the multi-agent system.

The Dashboard should answer, at a glance:

- What is currently running?
- What is waiting?
- What failed?
- Which agents are active?
- Which workflows/tasks need attention?
- What happened recently?

## Functional Requirements

The Dashboard should include at minimum:

- Active runs count
- Pending tasks count
- Completed tasks count
- Failed tasks count
- Active agents count
- Recent executions
- Recent failures/errors
- Tasks requiring human attention
- Quick navigation to Task Board, Org/Graph Editor, Agents, Tools, and Runs

## Run Status Model

The UI should support states such as:

```text
queued
running
waiting_for_agent
waiting_for_tool
waiting_for_human
completed
failed
cancelled
paused
```

These states should be represented consistently across the application.

## UX Requirements

- The page should remain useful even when no runs exist.
- Empty states should explain what the user can do next.
- Statuses must be visually distinguishable.
- Cards should link to the relevant detailed view.
- Recent failures should be easy to inspect.

## Architecture Requirements

The Dashboard must not own business logic.

Data should come from reusable services/store selectors so the same information can be consumed by:

- Dashboard
- Task Board
- Execution Timeline
- Run Detail views

## Definition of Done

The Dashboard gives a reliable system-level overview and provides navigation into the parts of the system that require attention.

---

# Phase 2 — Task Board ✅

## Goal

Provide a user-facing task orchestration interface where users can create, assign, prioritize, and track tasks executed by the multi-agent system.

The Task Board should behave as an operational layer above individual LangGraph runs.

## Core Task Model

Each task should support at minimum:

```text
id
name/title
description
status
priority
assignedAgentIds
workflowId
createdAt
updatedAt
startedAt
completedAt
parentTaskId (optional)
dependencies (optional)
result/run reference
metadata
```

## Functional Requirements

Users should be able to:

- Create a task
- Edit a task
- Delete/archive a task
- Assign one or multiple agents
- Associate a task with a workflow
- Set task priority
- Track task status
- Retry failed tasks
- Pause running work when runtime support exists
- Cancel work when runtime support exists
- Open the related execution/run
- View the final output/result

## Dependency Requirements

The task model should support task dependencies.

Example:

```text
Research Task
      ↓
Implementation Task
      ↓
Review Task
```

A dependent task should not start before required upstream tasks complete successfully unless explicitly configured otherwise.

## Task Status Requirements

Suggested task statuses:

```text
backlog
ready
queued
running
blocked
waiting_for_human
completed
failed
cancelled
```

## UX Requirements

The board may use columns such as:

```text
Backlog → Ready → Running → Review/Waiting → Done
```

but UI representation must remain separate from the domain status model.

Users should be able to inspect:

- Assigned agents
- Workflow
- Dependencies
- Current run
- Last error
- Final output

## Backend Requirements

Creating or starting a task should ultimately create a run through the backend/runtime rather than executing logic directly in the browser.

## Definition of Done

A user can create and manage tasks, assign agents/workflows, start execution, and navigate from a task to its actual run/result.

---

# Phase 3 — Visual Graph Editor ✅

## Goal

Provide a visual programming environment inside the `Org` page where users can design executable multi-agent workflows.

The graph is not merely a visualization. **The graph represents the program/workflow itself.**

## Core Architecture

```text
React Flow Graph Editor
        ↓
Workflow Definition
        ↓
Backend API
        ↓
Workflow Compiler / Graph Builder
        ↓
LangGraph StateGraph
        ↓
Execution
```

React Flow is the editor/view layer. The workflow definition is the domain model. LangGraph is the execution engine.

## Required Node Types

### Agent Node

Represents an AI agent.

Required fields:

- Agent ID
- Name
- Description
- Model
- System prompt
- Assigned tools
- Optional memory configuration
- Metadata/runtime configuration

### Tool Node

Represents an executable tool/function.

Required fields:

- Tool ID
- Name
- Description
- Configuration

### Human Approval Node

Pauses execution and waits for user approval/input.

Required fields:

- Approval message
- Approval type
- Optional timeout
- Approval metadata

### Memory Node

Represents memory access.

Required fields:

- Memory type
- Read/write/read-write mode
- Configuration

### Condition / Router Node

Represents conditional routing.

Must support multiple outgoing branches with branch keys or structured conditions.

### Input Node

Represents workflow input/entry.

### Output Node

Represents workflow output/termination.

## Edge Requirements

Edges must be directional and support:

- Normal edges
- Conditional edges
- Multiple incoming edges
- Multiple outgoing edges
- Edge labels
- Branch metadata
- Edge editing
- Edge deletion

## Conditional Routing

The workflow must support structures such as:

```text
Planner
   ↓
Condition
  /     \
approved rejected
  ↓        ↓
Coder   Researcher
```

Conditional data must be stored structurally, not only as a visual label.

## Parallel Branches

The graph must support structures such as:

```text
             ┌→ Researcher ─┐
Planner ─────┤              ├→ Reviewer
             └→ Coder ──────┘
```

Parallel semantics must be represented explicitly in workflow data and must never be inferred only from node positions.

## Loop / Cycle Requirements

The graph must support cycles where LangGraph supports them.

Example:

```text
Coder → Reviewer
  ↑       |
  └───────┘
```

Cycles should not automatically be rejected, but they must later be protected by validation and recursion/iteration limits.

## Workflow Definition

The workflow must be serializable independently of React Flow.

Example:

```json
{
  "id": "workflow-id",
  "nodes": [
    {
      "id": "planner",
      "type": "agent",
      "config": {
        "agentId": "planner-agent"
      }
    }
  ],
  "edges": [
    {
      "id": "planner-reviewer",
      "source": "planner",
      "target": "reviewer",
      "type": "normal"
    }
  ]
}
```

## Separation Requirements

Do not tightly couple the domain model to React Flow internals.

Prefer a conceptual separation such as:

```text
workflow.execution
workflow.layout
```

The editor should map between domain workflow data and React Flow state.

## UI Requirements

Suggested editor structure:

```text
┌─────────────────────────────────────────────────────┐
│ Toolbar                                              │
├──────────────┬──────────────────────────┬───────────┤
│ Node Palette │                          │           │
│              │      Graph Canvas        │ Properties│
│ Agent        │                          │ Panel     │
│ Tool         │                          │           │
│ Condition    │                          │           │
│ Approval     │                          │           │
│ Memory       │                          │           │
│ Input        │                          │           │
│ Output       │                          │           │
├──────────────┴──────────────────────────┴───────────┤
│ Save / Validation / Status                          │
└─────────────────────────────────────────────────────┘
```

## Definition of Done

A user can visually design a multi-agent workflow, serialize it into a workflow definition, save/load it, and provide enough structured information for the backend to later compile it into LangGraph.

---

# Phase 4 — Execution Timeline & Live Execution

## Goal

Make executions observable in real time.

After starting a task/workflow, the user should be able to see **what the system is doing right now**, which agent/node is active, what already happened, what failed, and what is waiting.

This page is the bridge between the visual workflow definition and the actual runtime behavior.

## Core Concepts

Introduce explicit concepts for:

```text
Run
Run Event
Node Execution
Agent Execution
Tool Execution
Human Approval Event
State Transition
```

## Required Run Model

Each workflow execution should have a stable Run entity containing at least:

```text
runId
workflowId
taskId (optional)
status
startedAt
completedAt
input
output
error
currentNodeId
metadata
```

## Required Event Model

Execution events should be append-only and ordered.

Example event types:

```text
run.created
run.started
run.paused
run.resumed
run.completed
run.failed
run.cancelled

node.started
node.completed
node.failed
node.retrying

agent.started
agent.completed
agent.failed

llm.started
llm.completed
llm.failed

tool.started
tool.completed
tool.failed

human_approval.requested
human_approval.approved
human_approval.rejected

state.updated
edge.traversed
```

Each event should include as appropriate:

- ID
- Run ID
- Timestamp
- Node ID
- Agent ID
- Tool ID
- Event type
- Status
- Input/output summary
- Error information
- Duration
- Metadata

## Live Transport Requirements

Use server-to-client streaming instead of polling as the primary mechanism.

Preferred options:

- SSE for one-way execution streams
- WebSocket if bidirectional real-time control is required

The transport layer should be abstract enough to change later without rewriting the UI.

## Timeline UI Requirements

The timeline should show chronological execution events.

For each event, display relevant information such as:

- Timestamp
- Node/agent/tool name
- Event type
- Status
- Duration
- Error indicator
- Expandable input/output details

Example:

```text
10:32:01  Run started
10:32:01  Planner started
10:32:04  Planner completed        3.1s
10:32:04  Researcher started
10:32:04  Coder started
10:32:09  Researcher completed     5.2s
10:32:11  Coder completed          7.1s
10:32:11  Reviewer started
10:32:15  Reviewer completed       4.0s
10:32:15  Run completed
```

## Graph Synchronization Requirements

The Execution Timeline should synchronize with the Graph Editor visualization.

During execution:

- Active node should be highlighted.
- Completed nodes should have completed state.
- Failed nodes should show failure state.
- Waiting nodes should show waiting state.
- Traversed edges may be highlighted.
- Parallel running nodes should be shown simultaneously.

Do not mutate the saved workflow definition merely to represent runtime state.

Runtime visualization state must remain separate from workflow design state.

## Run Controls

Where backend support exists, provide:

- Start
- Pause
- Resume
- Cancel
- Retry failed run
- Retry failed node/subtask when semantically safe

## Error Requirements

Failures should show:

- Which node failed
- Agent/tool involved
- Error type/message
- Timestamp
- Relevant input
- Retryability if known

Do not expose secrets, API keys, or credentials in raw event payloads.

## History Requirements

Users should be able to open completed runs and replay their timeline from stored events.

Live execution and historical execution should use the same UI model whenever possible.

## Definition of Done

A user can start a workflow/task and watch execution evolve in real time, inspect individual events, see graph node states update, and later reopen the completed run with the same timeline.

---

# Phase 5 — Agent Management & Configuration

Implemented for browser-local Studio persistence and API execution. See [agent detail implementation](agent-detail-page.md) for configuration, standalone testing, migration, regression coverage, and limits. Agent memory is bounded to one run; CLI/local executors and persistent memory remain later work.

## Goal

Create agents as reusable first-class entities independent from individual workflow nodes.

## Agent Domain Model

Each agent should support at minimum:

```text
id
name
description
modelProvider
modelName
systemPrompt
temperature/model settings
assignedTools
memory configuration
runtime configuration
createdAt
updatedAt
metadata
```

## Functional Requirements

Users should be able to:

- Create an agent
- Edit an agent
- Duplicate an agent
- Delete/archive an agent
- Enable/disable an agent
- Assign tools
- Configure model/provider
- Configure system prompt
- Configure memory behavior
- Inspect where the agent is used

## Reusability Requirement

An Agent entity and an Agent Node are different concepts.

```text
Agent Entity
    ↓ referenced by
Agent Node in Workflow
```

A single agent should be reusable across multiple workflows.

## Configuration Requirements

The configuration UI should support provider/model-specific options without hard-coding every provider directly into the page.

Prefer provider adapters/config schemas.

## Security Requirements

- Provider API keys must never be stored in browser state as normal domain data.
- Secret values must not appear in workflow JSON.
- Secret configuration belongs to server-side secure configuration.

## Testing Requirement

Provide a lightweight way to test an agent configuration with a sample input without requiring construction of a full workflow.

## Definition of Done

Users can manage reusable agents independently and reference them from graph workflows reliably.

---

# Phase 6 — Tool Management

## Goal

Manage tools that agents/workflows can invoke.

Tools are reusable runtime capabilities and should not be hard-coded into individual agents.

## Tool Model

Each tool should support:

```text
id
name
description
type
inputSchema
outputSchema
configuration
enabled
permissions/security metadata
createdAt
updatedAt
```

## Supported Tool Categories

Architecture should allow tool categories such as:

- Internal functions
- HTTP/API tools
- Database tools
- Search tools
- File tools
- MCP tools
- CLI tools
- Custom application tools

Not all categories need full implementation in the MVP, but the model must be extensible.

## Functional Requirements

Users should be able to:

- Register a tool
- Configure a tool
- Enable/disable a tool
- Test a tool
- Assign a tool to agents
- Use a tool node in workflows
- Inspect recent failures

## Schema Requirements

Tools should have structured input/output contracts when possible.

Prefer JSON Schema, Zod-derived schemas, or another consistent schema format.

## Permission Requirements

The runtime should be capable of restricting tool use per:

- Agent
- Workflow
- Environment
- User/organization if multi-user support is added later

## Secret Handling

Credentials must be server-side and referenced indirectly.

Never persist secrets in the visual workflow definition.

## Definition of Done

Tools are reusable, configurable, testable, assignable to agents, and safely callable by the runtime.

---

# Phase 7 — Human-in-the-Loop & Approval System

## Goal

Support workflows that intentionally stop and wait for human decisions or input.

This turns Human Approval nodes from visual concepts into real runtime behavior.

## Required Approval States

```text
requested
approved
rejected
expired
cancelled
```

## Approval Model

Each approval request should contain at minimum:

```text
approvalId
runId
nodeId
status
message
requestedAt
resolvedAt
input/context
response
metadata
```

## Runtime Requirements

When execution reaches a Human Approval node:

1. Persist the current execution/checkpoint.
2. Emit a `human_approval.requested` event.
3. Change run status to `waiting_for_human`.
4. Surface the request in the UI.
5. Wait without losing run state.
6. Resume execution after approval/rejection/input.

## UI Requirements

Approval requests should be visible in:

- Dashboard
- Task detail
- Run detail / Execution Timeline
- Approval inbox/queue if necessary

## Interaction Requirements

A user should be able to:

- Approve
- Reject
- Enter requested text/data
- Inspect the context before making a decision

## Branching Requirements

Approval outcome must be usable by conditional routing.

Example:

```text
Human Approval
    ├── approved → Deploy Agent
    └── rejected → Revision Agent
```

## Definition of Done

A workflow can pause safely, persist its state, request a human decision, and resume from that exact point after the decision.

---

# Phase 8 — Memory Management & Memory Explorer

## Goal

Make agent/workflow memory explicit, inspectable, and configurable.

## Memory Categories

Architecture should distinguish at least conceptually:

- Run-scoped state
- Conversation/thread memory
- Agent memory
- Long-term memory
- Shared workflow/team memory

## Functional Requirements

Users should eventually be able to:

- Configure whether an agent uses memory
- Select memory scope
- Inspect stored memory
- Search memory
- Delete/clear memory where allowed
- Inspect which run/agent created a memory item

## Memory Node Requirements

Memory nodes in the graph should support operations such as:

```text
read
write
read-write
search
```

## Data Requirements

Memory entries should contain metadata such as:

```text
id
scope
agentId
workflowId
runId
content/value
createdAt
updatedAt
source
metadata
```

## Safety Requirements

- Do not accidentally expose one workflow/user's private memory to another scope.
- Memory access must be explicit.
- Provide retention/deletion mechanisms.
- Avoid storing secrets in ordinary memory records.

## MVP Constraint

A full vector database UI is not required initially.

Start with inspectability and clear memory boundaries.

## Definition of Done

Memory behavior is configurable and users can understand what memory exists, who created it, and how it affects execution.

---

# Phase 9 — Persistence, Runs, History & Recovery

## Goal

Make the system durable so workflows and executions survive process restarts and can be inspected/recovered later.

## Persistent Entities

Persist at minimum:

- Agents
- Tools
- Workflows
- Tasks
- Runs
- Run events
- Approval requests
- Memory metadata/content as appropriate

## Database Requirements

Use PostgreSQL as the primary durable data store unless the existing architecture already provides another deliberate choice.

Use Redis only for transient/coordination concerns such as:

- queues,
- locks,
- ephemeral execution state,
- caching,
- pub/sub,

not as the sole authoritative store for critical data.

## Workflow Persistence

A saved workflow must preserve:

- Execution definition
- Node configuration
- Edge configuration
- Layout/editor metadata
- Version metadata

## Run History

Users should be able to:

- List previous runs
- Filter by workflow/task/status/date
- Open a run
- View its timeline
- View its result
- View failure details

## Recovery Requirements

Where supported by LangGraph/checkpointing:

- Interrupted runs should be recoverable.
- Human-approval waits must survive server restarts.
- Run state should not depend solely on process memory.

## Idempotency Requirements

Actions such as retry/resume should be designed to avoid accidental duplicate execution where possible.

## Definition of Done

The core system survives restarts without losing workflows, tasks, or execution history, and recoverable runs can continue safely.

---

# Phase 10 — Observability & Langfuse Integration

## Goal

Use Langfuse as the observability/evaluation layer instead of rebuilding full LLM tracing inside the Studio.

## Responsibility Split

### Multi-Agent Studio

The Studio owns the **Control Plane**:

- Tasks
- Agents
- Workflows
- Graph Editor
- Runs
- Execution Timeline
- Human approvals
- Run controls
- System status

### Langfuse

Langfuse owns the **Observability / Evaluation Plane**:

- LLM traces
- Prompt/response inspection
- Token usage
- Cost
- Latency
- Tool spans
- Nested agent execution traces
- Errors
- Evaluations
- Prompt management where adopted

## Integration Requirements

Each Studio run should be correlatable with Langfuse through stable identifiers such as:

```text
runId
workflowId
taskId
agentId
nodeId
```

## UI Requirements

The Studio should expose useful high-level observability fields such as:

- Run duration
- Token count
- Estimated cost
- Error count
- Agent/tool execution duration

and provide direct navigation to the corresponding Langfuse trace when deeper inspection is needed.

## Instrumentation Requirements

Instrument:

- Workflow run
- Node execution
- Agent execution
- LLM calls
- Tool calls
- Important routing decisions

Prefer OpenTelemetry-compatible instrumentation.

## Non-Goal

Do not build a full Langfuse clone inside the custom UI.

## Definition of Done

Every meaningful execution can be correlated to a Langfuse trace, while the Studio remains focused on orchestration/control.

---

# Phase 11 — Validation, Safety & Runtime Guardrails

## Goal

Prevent invalid or dangerous workflows from being executed accidentally.

## Graph Validation

Validate at minimum:

- Duplicate node IDs
- Duplicate edge IDs
- Missing node references
- Invalid node config
- Missing required agent config
- Missing tool config
- Invalid conditional branches
- Ambiguous branching semantics
- Invalid input/output structure
- Unsupported connections
- Unsafe cycles

## Structured Validation Model

Prefer results such as:

```ts
{
  level: "error" | "warning",
  code: "INVALID_EDGE_REFERENCE",
  message: "Edge references a missing node",
  nodeId?: "...",
  edgeId?: "..."
}
```

## Runtime Guardrails

Add protections such as:

- Maximum recursion/loop count
- Maximum run duration
- Tool timeouts
- LLM timeouts
- Retry limits
- Maximum concurrent branches
- Maximum token/cost limits when available
- Cancellation support

## Tool Safety

Tools with side effects should be identifiable.

Examples:

```text
read-only
write
external side effect
high impact
```

High-impact tools may later require explicit approval policies.

## Secret Redaction

Logs, traces, and timeline events must avoid exposing:

- API keys
- Access tokens
- Passwords
- Private credentials

## Backend Authority

Frontend validation improves UX, but the backend must always perform authoritative validation before compilation/execution.

## Definition of Done

Invalid workflows are blocked before execution and runaway/unsafe runtime behavior is constrained by explicit guardrails.

---

# Phase 12 — Production Hardening & Developer Experience

## Goal

Turn the MVP into a maintainable, deployable engineering project without prematurely splitting it into unnecessary microservices.

## Recommended Architecture

Keep the MVP simple:

```text
multi-agent/
├── apps/
│   ├── web/
│   └── server/
│       ├── agents/
│       ├── graphs/
│       ├── tools/
│       ├── tasks/
│       ├── execution/
│       └── api/
├── packages/
│   ├── ui/
│   ├── types/
│   └── shared/
├── infrastructure/
└── docs/
```

The server may contain both API and LangGraph runtime for now.

Do not split `agent-runtime` into a separate service unless there is a real scaling/deployment need.

## Monorepo Requirements

Use a lightweight monorepo setup such as pnpm workspaces.

Do not introduce Nx/Turborepo unless build complexity makes it useful.

## Testing Requirements

Add tests at multiple levels:

### Unit Tests

- Workflow validation
- Workflow-to-LangGraph compiler/builder
- State transitions
- Agent/tool config validation

### Integration Tests

- Task → Run creation
- Workflow execution
- Tool invocation
- Human approval pause/resume
- Persistence/checkpoint recovery

### E2E Tests

Critical user paths:

```text
Create Agent
→ Create Workflow
→ Create Task
→ Start Run
→ Observe Timeline
→ Complete/Approve
→ Inspect Result
```

## CI Requirements

GitHub Actions should at least run:

- install
- lint
- typecheck
- tests
- build

## Containerization

Docker Compose is enough for the current stage.

A local development environment may include:

- web
- server
- PostgreSQL
- Redis
- Langfuse dependencies when self-hosting is used

## Logging Requirements

Use structured logs with stable correlation IDs:

```text
runId
workflowId
taskId
nodeId
agentId
```

## Documentation Requirements

Maintain documentation for:

- Architecture
- Workflow definition schema
- Node types
- Edge types
- Runtime event schema
- Agent model
- Tool model
- Development setup
- Environment variables

## Performance Requirements

Avoid optimizing prematurely, but monitor:

- Graph rendering performance
- Event stream size
- Long-running execution memory usage
- Database query patterns
- Parallel workflow concurrency

## Definition of Done

The project can be installed, tested, built, run locally, and deployed predictably, while retaining a simple architecture appropriate for the current product stage.

---

# End-to-End Target Experience

When these phases are complete, the intended user flow is:

```text
1. Create/configure reusable Agents
            ↓
2. Register/assign Tools
            ↓
3. Open Org / Graph Editor
            ↓
4. Visually design the multi-agent workflow
            ↓
5. Save/validate workflow
            ↓
6. Create a Task and select the workflow
            ↓
7. Start execution
            ↓
8. Watch Execution Timeline + live graph state
            ↓
9. Approve/reject Human-in-the-Loop steps if required
            ↓
10. Inspect final output
            ↓
11. Inspect detailed Langfuse trace when needed
            ↓
12. Reopen any historical run later
```

The end goal is a system where users can **visually program multi-agent systems**, execute them, control them, and understand exactly what happened during execution without needing to operate the system through a terminal.
