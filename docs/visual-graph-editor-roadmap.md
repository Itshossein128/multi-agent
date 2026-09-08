# Visual Multi-Agent Graph Editor Roadmap

This document defines the implementation roadmap and detailed requirements for the **Visual Multi-Agent Programming / Graph Editor** feature inside the `Org` page.

The graph is not merely a visualization. It represents the executable workflow of the multi-agent system. Users should be able to visually design a multi-agent workflow and later have the backend translate that workflow definition into a LangGraph `StateGraph` for execution.

The core architecture is:

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

React Flow is the editor/view layer. The workflow definition is the domain representation and source of truth. LangGraph is the execution engine.

---

# Progress

- [x] 1. Graph Editor
- [x] 2. Node Types
- [x] 3. Edges
- [ ] 4. Parallel Branches
- [ ] 5. Loops / Cycles
- [ ] 6. Agent Creation
- [ ] 7. Workflow Definition
- [ ] 8. State Management
- [ ] 9. Persistence
- [ ] 10. Validation
- [ ] 11. LangGraph Integration Boundary
- [ ] 12. UI / UX
- [ ] 13. Architecture Requirements
- [ ] 14. MVP Scope Constraints

---

# 1. Graph Editor ✅

## Goal

Build the main visual programming surface inside the `Org` page using **React Flow**.

The graph editor should behave like a workflow/programming environment rather than a static diagram.

## Functional Requirements

The editor must support:

- Pan around the canvas
- Zoom in/out
- Fit graph to viewport
- Node selection
- Edge selection
- Multiple selection
- Node dragging
- Node creation
- Node deletion
- Edge creation
- Edge deletion
- Connecting nodes via handles
- Reconnecting edges when possible
- Keyboard shortcuts for common operations when practical
- Selection clearing
- Canvas click handling
- Drag-and-drop node creation if a node palette is used
- Basic minimap support if it improves navigation

## Interaction Requirements

- Clicking a node selects it.
- Clicking an edge selects it.
- Clicking empty canvas clears selection.
- Dragging a node updates its visual position.
- Dragging from an output handle to an input handle creates a directional edge.
- Invalid connections should be rejected or surfaced to the user.
- Deleting selected graph elements must update the editor state consistently.
- The editor should remain usable with a non-trivial number of nodes.

## Technical Requirements

- Use React Flow as the graph rendering/editing layer.
- Keep graph-specific UI code isolated from business/domain logic.
- Avoid embedding persistence logic directly inside the React Flow component.
- Avoid a single oversized component that owns all editor responsibilities.

## Definition of Done

This stage is complete when users can create, move, select, connect, and delete graph elements reliably inside the `Org` page.

---

# 2. Node Types ✅

## Goal

Represent all important multi-agent workflow building blocks as extensible custom node types.

## Required Node Types

### Agent Node

Represents an AI agent.

Required properties:

- `id`
- `agentId`
- `name`
- `description`
- `model`
- `systemPrompt`
- `tools`
- `metadata`
- Other runtime configuration as needed

Requirements:

- Must expose clearly defined input/output handles.
- Agent identity must be independent of React Flow coordinates.
- Visual state must not be the source of truth for agent configuration.

### Tool Node

Represents a callable tool/function.

Required properties:

- `id`
- `toolId`
- `name`
- `description`
- `configuration`

Requirements:

- Must be visually distinguishable from agent nodes.
- Must be connectable within the workflow.
- Tool configuration should be editable through a property/configuration UI.

### Human Approval Node

Pauses workflow execution and waits for human approval or input.

Required properties:

- `id`
- `approvalMessage`
- `approvalType`
- Optional `timeout`
- Optional approval metadata

Requirements:

- Must clearly communicate that execution stops until human input is received.
- Should support approval/rejection branching later.

### Memory Node

Represents workflow or agent memory access.

Required properties:

- `id`
- `memoryType`
- `mode` (`read`, `write`, or `read-write`)
- `configuration`

Requirements:

- Must be able to represent memory read/write intent.
- Runtime-specific implementation details should remain backend concerns.

### Condition / Router Node

Represents conditional branching.

Requirements:

- Must support multiple outgoing paths.
- Each outgoing path should have a condition/branch key.
- Node configuration must identify routing logic or routing metadata.

Example:

```text
Planner
   |
   v
Condition
  / \
yes  no
 |    |
 v    v
Coder Researcher
```

### Input Node

Represents workflow entry/input.

Requirements:

- Clearly identifies input origin.
- Should normally have no incoming workflow edge.
- Must expose workflow input configuration when needed.

### Output Node

Represents workflow termination/output.

Requirements:

- Clearly identifies workflow output.
- Should normally have no outgoing workflow edge.
- Must support output mapping/configuration later.

## Extensibility Requirements

Adding a new node type later should not require rewriting the editor.

Prefer a registry/configuration-based approach such as:

```ts
nodeTypes = {
  agent: AgentNode,
  tool: ToolNode,
  condition: ConditionNode,
  approval: HumanApprovalNode,
  memory: MemoryNode,
  input: InputNode,
  output: OutputNode,
}
```

## Definition of Done

This stage is complete when all required node categories can be rendered, identified, connected, and configured independently.

---

# 3. Edges ✅

## Goal

Represent execution/control/data flow between nodes using directional edges.

## Functional Requirements

Support:

- Normal directional edges
- Conditional edges
- Multiple incoming edges
- Multiple outgoing edges
- Edge labels
- Edge selection
- Edge deletion
- Edge configuration
- Edge direction visualization
- Connection validation

## Direction Requirement

Connections must explicitly communicate direction.

Example:

```text
A → B
```

The graph must never treat workflow edges as undirected relationships.

## Conditional Edge Requirements

A conditional edge must support configuration such as:

```text
condition = "approved"
condition = "rejected"
```

or another structured branch key/expression representation.

Conditional metadata must not exist only as text painted on the edge. It must be represented in the workflow data model.

## Editing Requirements

Users should be able to:

- Select an edge
- Inspect its configuration
- Change its type where valid
- Edit label/condition metadata
- Delete it

## Technical Requirements

Do not make React Flow's `Edge` object the permanent domain model.

React Flow edges may be mapped to/from a workflow edge representation.

## Definition of Done

This stage is complete when edges correctly represent directed workflow transitions and conditional branch metadata can be captured reliably.

---

# 4. Parallel Branches

## Goal

Allow workflows to represent multiple branches that can execute independently or concurrently.

Example:

```text
             ┌→ Researcher ─┐
Planner ─────┤              ├→ Reviewer
             └→ Coder ──────┘
```

## Functional Requirements

- A node may have multiple outgoing edges.
- Parallel branches must be distinguishable from conditional exclusive branches.
- Multiple branches may converge into a later node.
- The workflow definition must preserve branch relationships.
- The visual editor must not implicitly serialize parallel branches.

## Domain Model Requirements

The workflow representation should make it possible for the backend compiler to determine whether multiple outgoing paths are:

- Parallel
- Conditional/exclusive
- Normal independent transitions

If needed, represent this through:

- Node type
- Edge metadata
- Branch/group metadata
- Explicit parallel/fork node semantics

Do not rely only on canvas geometry to infer parallelism.

## Backend Boundary

The frontend only represents workflow intent.

The frontend must not implement actual concurrency scheduling.

Actual parallel execution belongs to the LangGraph/backend runtime.

## Validation Requirements

Warn about structurally ambiguous parallel branches when the backend would not be able to determine intended semantics.

## Definition of Done

Parallel execution intent can be expressed explicitly, serialized, saved, and later interpreted by the workflow compiler.

---

# 5. Loops / Cycles

## Goal

Allow cyclic workflows instead of assuming every graph is a DAG.

Example:

```text
Coder → Reviewer
  ↑       |
  └───────┘
```

## Functional Requirements

- Users must be allowed to connect a downstream node back to an upstream node.
- The graph editor must not automatically reject all cycles.
- Cyclic edges must render normally and remain editable.
- Loop configuration may later include exit conditions or limits.

## Safety / Validation Requirements

The system should identify potentially unsafe loops, such as:

- Cycle with no obvious exit path
- Loop with no conditional transition
- Invalid self-loop where unsupported
- Loop lacking an execution limit if the runtime requires one

The frontend should warn rather than over-constrain unless a structure is definitely invalid.

## Domain Model Requirements

Cycles must be represented explicitly in the workflow definition through normal node/edge references.

Do not flatten or remove cycles during serialization.

## Backend Requirements

The authoritative runtime/compiler must determine whether the loop is executable by LangGraph.

The backend should later enforce runtime protections such as recursion/iteration limits where appropriate.

## Definition of Done

Users can visually create valid cycles, serialize them without corruption, and receive warnings for obviously unsafe structures.

---

# 6. Agent Creation

## Goal

Allow users to create and configure agents directly from the `Org` page and then use them as workflow nodes.

## User Flow

```text
Create Agent
     ↓
Configure Agent
     ↓
Persist/Create Agent Entity
     ↓
Agent appears as a node
     ↓
Connect it to workflow
```

## Required Agent Fields

At minimum:

- Name
- Description
- Model/provider selection
- System prompt
- Assigned tools
- Optional memory configuration
- Optional metadata

## Architecture Requirements

Separate the concepts of:

1. **Agent entity/configuration**
2. **Agent node instance in a workflow**

An agent entity may potentially be reusable across workflows.

Its identity must not depend on:

- React Flow node ID alone
- Canvas coordinates
- Visual styling

The graph node should reference the agent through `agentId` or equivalent.

## UX Requirements

- Provide a clear create-agent action.
- Validate required agent fields.
- After creation, allow immediate use on the graph.
- Allow selecting an existing agent where appropriate.
- Allow editing agent configuration through a dedicated panel/modal without destroying graph connections.

## Definition of Done

A user can create an agent, configure it, and use it as a stable workflow node without coupling the underlying agent identity to graph layout.

---

# 7. Workflow Definition

## Goal

Create a clean, framework-independent domain representation for visual workflows.

This is one of the most important architectural stages.

## Core Principle

React Flow state is **not** the workflow source of truth.

The domain workflow definition is the source of truth.

React Flow is a visualization/editing adapter around that model.

## Required Structure

A minimal workflow definition should support:

```json
{
  "id": "workflow-id",
  "name": "Workflow Name",
  "version": 1,
  "nodes": [
    {
      "id": "planner-node",
      "type": "agent",
      "config": {
        "agentId": "planner-agent"
      }
    }
  ],
  "edges": [
    {
      "id": "planner-reviewer",
      "source": "planner-node",
      "target": "reviewer-node",
      "type": "normal",
      "config": {}
    }
  ],
  "metadata": {}
}
```

## Required Capabilities

The model must be able to represent:

- Agent nodes
- Tool nodes
- Human approval nodes
- Memory nodes
- Input/output nodes
- Condition/router nodes
- Normal edges
- Conditional edges
- Parallel branches
- Cycles
- Node configuration
- Edge configuration
- Workflow metadata

## Separation Requirements

Do not store React Flow-specific fields inside the core execution definition unless needed for editor metadata.

If positions need persistence, prefer separating them conceptually, e.g.:

```ts
workflow.execution
workflow.layout
```

or use clearly separated metadata fields.

## Conversion Requirements

Implement explicit mapping functions such as:

```ts
toReactFlow(workflow)
fromReactFlow(nodes, edges)
```

or equivalent adapters.

## Definition of Done

The complete workflow can be serialized to structured data and reconstructed without depending on React Flow internals.

---

# 8. State Management

## Goal

Manage editor and workflow state predictably without mixing visual state, domain state, and persistence state.

## Required State Categories

### Workflow Domain State

- Workflow ID
- Workflow metadata
- Workflow nodes
- Workflow edges
- Node configuration
- Edge configuration

### Editor State

- Selected node(s)
- Selected edge(s)
- Viewport
- Temporary drag/connect state
- Panel state
- Editor mode

### Persistence State

- Is loading
- Is saving
- Is dirty
- Last saved timestamp/version
- Save error

## Functional Requirements

Support:

- Adding/removing nodes
- Adding/removing edges
- Updating node config
- Updating edge config
- Updating layout
- Selection
- Dirty tracking
- Reset/reload
- Save completion state
- Undo/redo if practical within MVP constraints

## Technical Requirements

- Use the project's existing state-management solution where possible.
- Do not introduce another global store library without a clear reason.
- Keep state update APIs explicit and testable.
- Avoid mutating graph/domain data directly inside presentation components.

## Definition of Done

All graph edits flow through predictable state operations and the application can distinguish editor-only changes from persisted workflow changes.

---

# 9. Persistence

## Goal

Make workflow definitions saveable/loadable through a clean backend-facing abstraction.

## Required Service Boundary

Provide an API/service layer similar to:

```ts
getWorkflow(workflowId)
saveWorkflow(workflow)
createWorkflow(workflow)
updateWorkflow(workflow)
deleteWorkflow(workflowId)

createAgent(agent)
updateAgent(agent)
deleteAgent(agentId)
getAgents()
```

## Requirements

- UI components must not call raw persistence implementation details directly.
- React Flow components must not know database structure.
- Saving should serialize the domain workflow definition.
- Loading should hydrate domain state and then map it into React Flow state.
- Save errors must be surfaced to the user.
- Dirty state should clear only after successful save.

## Temporary Backend Strategy

If backend APIs are not yet available:

- Use mocks/in-memory/local persistence behind the same service interface.
- Keep the interface compatible with future server implementation.
- Do not hard-code temporary storage behavior throughout components.

## Data Integrity Requirements

The persistence layer should preserve:

- Workflow structure
- Node config
- Edge config
- Layout metadata if applicable
- Version/metadata fields

## Definition of Done

A workflow can be saved, reloaded, and reconstructed without loss of structure or configuration.

---

# 10. Validation

## Goal

Catch invalid workflow structures early while leaving authoritative runtime validation to the backend.

## Required Frontend Validations

At minimum:

- Duplicate node IDs
- Duplicate edge IDs
- Edge references to missing nodes
- Required agent config missing
- Invalid node configuration
- Invalid conditional edge configuration
- Condition node with invalid branch configuration
- Missing required input/output where workflow rules require them
- Invalid connection between incompatible node types
- Dangling nodes where relevant
- Ambiguous parallel/conditional branching
- Structurally suspicious cycles

## Validation Model

Prefer structured validation results such as:

```ts
{
  level: "error" | "warning",
  code: "INVALID_EDGE_REFERENCE",
  message: "Edge references a missing node",
  nodeId?: "...",
  edgeId?: "..."
}
```

## UX Requirements

- Show overall validation status.
- Highlight affected node/edge when possible.
- Distinguish warnings from blocking errors.
- Allow navigating from a validation issue to the graph element.

## Backend Boundary

Frontend validation is advisory/pre-flight validation.

The backend/compiler must revalidate the workflow before execution.

Never assume a workflow is safe to execute only because frontend validation passed.

## Definition of Done

Invalid workflow structures can be identified before save/execution with actionable user feedback.

---

# 11. LangGraph Integration Boundary

## Goal

Establish the contract between the visual workflow model and backend LangGraph execution.

## Core Rule

The frontend must **not** rewrite or generate TypeScript source files as its persistence mechanism.

Instead:

```text
Graph Editor
    ↓
Workflow Definition
    ↓
Backend Compiler
    ↓
LangGraph StateGraph
```

## Backend Compiler Responsibilities

The backend should eventually:

1. Receive a workflow definition.
2. Validate it.
3. Resolve referenced agents/tools/memory components.
4. Create a LangGraph `StateGraph`.
5. Add nodes.
6. Add normal edges.
7. Add conditional edges.
8. Configure branching/parallelism.
9. Preserve supported cycles.
10. Compile the graph.
11. Execute it.
12. Return runtime state/events/results.

Conceptually:

```ts
const graph = new StateGraph(StateSchema)

for (const node of workflow.nodes) {
  graph.addNode(node.id, resolveNodeHandler(node))
}

for (const edge of workflow.edges) {
  // normal / conditional / other workflow semantics
}

const compiledGraph = graph.compile()
```

## Important Design Principle

The graph created by the user is the **program**.

The workflow definition is the **intermediate representation (IR)**.

The LangGraph builder/compiler is the **compiler/runtime adapter**.

LangGraph is the **execution engine**.

## API Boundary

The frontend should eventually communicate through APIs such as:

```text
POST /workflows
PUT  /workflows/:id
POST /workflows/:id/validate
POST /workflows/:id/run
GET  /runs/:id
```

Exact endpoint naming may follow the existing backend architecture.

## Definition of Done

The frontend workflow model has a stable contract that the backend can compile into LangGraph without relying on generated source-code files.

---

# 12. UI / UX

## Goal

Make the graph editor feel like a professional visual developer tool.

## Suggested Layout

```text
┌─────────────────────────────────────────────────────┐
│ Toolbar                                              │
├──────────────┬──────────────────────────┬───────────┤
│ Node Palette │                          │           │
│              │      Graph Canvas        │ Properties│
│ Agent        │                          │           │
│ Tool         │                          │           │
│ Condition    │                          │           │
│ Approval     │                          │           │
│ Memory       │                          │           │
│ Input        │                          │           │
│ Output       │                          │           │
├──────────────┴──────────────────────────┴───────────┤
│ Status / Save / Validation                           │
└─────────────────────────────────────────────────────┘
```

## Required Interactions

- Drag a node type from palette to canvas.
- Click node to inspect/configure it.
- Drag from output handle to input handle to create an edge.
- Click edge to inspect/configure it.
- Delete selected elements.
- Save workflow.
- Validate workflow.
- Show unsaved-change state.
- Show loading/saving state.
- Provide clear error feedback.

## Visual Requirements

Different node types should be visually distinguishable.

At minimum, distinguish:

- Agent
- Tool
- Condition
- Human approval
- Memory
- Input
- Output

Edges should visually distinguish:

- Normal transitions
- Conditional transitions
- Selected state

Loops and parallel branches should remain visually understandable.

## Properties Panel

The right-side properties panel should adapt to the selected graph element.

For nodes, show node-specific configuration.

For edges, show edge type, label, condition, and related metadata.

## Developer Tool Feel

Prioritize:

- Clarity
- Dense but readable information
- Fast editing
- Minimal unnecessary modal flows
- Useful keyboard interactions
- Predictable selection behavior

Use the project's existing design system/UI component library.

## Definition of Done

A user can build and understand a workflow without needing to inspect raw JSON or backend code.

---

# 13. Architecture Requirements

## Goal

Keep the feature modular, maintainable, and extensible as it grows from an MVP into a more capable visual programming system.

## Recommended Module Boundaries

```text
Graph Editor
├── Canvas
├── Toolbar
├── Node Palette
├── Custom Nodes
├── Custom Edges
├── Properties Panel
├── Workflow State
├── Workflow Domain Model
├── React Flow Adapters
├── Validation
├── Persistence/API Layer
└── Utilities
```

## Separation of Concerns

### Canvas

Responsible for React Flow rendering/interactions.

### Custom Nodes / Edges

Responsible for element-specific rendering only.

### Properties Panel

Responsible for editing selected element configuration.

### Workflow Domain Model

Defines framework-independent workflow types.

### React Flow Adapters

Maps workflow domain data to/from React Flow structures.

### Validation

Contains structural validation logic.

### Persistence/API Layer

Contains communication with server/storage.

### State Layer

Coordinates domain/editor state transitions.

## Extensibility Requirements

Adding a new node type should ideally involve:

1. Define its domain config type.
2. Register a renderer.
3. Register validation rules.
4. Register configuration UI.
5. Later register backend compiler/runtime handling.

It should not require modifying unrelated editor internals.

## Code Quality Requirements

- Avoid giant components.
- Avoid duplicate node/edge logic.
- Prefer typed discriminated unions for node types where practical.
- Keep domain types strongly typed.
- Keep UI and backend contract types aligned through shared packages/types if the monorepo structure supports it.
- Avoid unnecessary abstractions that slow MVP delivery.

## Definition of Done

The editor architecture can support additional workflow primitives without major rewrites.

---

# 14. MVP Scope Constraints

## Goal

Ship a strong visual multi-agent programming MVP without turning the project into a full LangGraph Studio clone during this phase.

## MVP Priorities

Implement in this order:

1. Agent nodes
2. Tool nodes
3. Human approval nodes
4. Memory nodes
5. Condition/router nodes
6. Input/output nodes
7. Directed edges
8. Conditional edges
9. Parallel branches
10. Loops/cycles
11. Workflow serialization
12. Workflow state management
13. Save/load boundary
14. Validation
15. Backend LangGraph compiler boundary
16. Clean developer-oriented UX

## Explicitly Out of Scope for This Phase

Do **not** spend excessive time implementing:

- Full LangGraph Studio replacement
- Distributed execution infrastructure
- Production-grade collaborative editing
- Real-time multi-user graph editing
- Advanced workflow version-control UI
- Advanced visual debugging
- Breakpoints
- Time-travel debugging
- Complex execution animation systems
- Enterprise permission systems for individual nodes
- Full observability implementation already covered by tools such as Langfuse
- Advanced auto-layout engines unless trivially integrable
- Arbitrary TypeScript code generation/editing from the browser

## Architecture Constraint

Even while keeping the MVP small, do not create shortcuts that make the visual workflow disposable.

The central product principle must remain:

> **The user visually programs the multi-agent system through the graph, the workflow definition represents that program, and the backend translates it into an executable LangGraph workflow.**

## Final MVP Definition of Done

The MVP is successful when a user can:

1. Open the `Org` page.
2. Create/configure agents and workflow components.
3. Arrange them visually.
4. Connect them with directional and conditional edges.
5. Represent branching, parallel execution, and loops.
6. Add human approval, tools, memory, input, and output steps.
7. Save the workflow as a structured domain definition.
8. Reload the workflow without losing structure/configuration.
9. Validate common structural errors.
10. Send the workflow definition to a backend boundary that can later compile it into LangGraph.

At that point, the feature is no longer just a graph editor: it is the first usable version of a **Visual Programming Environment for Multi-Agent Systems**.
