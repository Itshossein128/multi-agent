# Feature Specification: Autonomous ReAct Agent Loop

**Feature Branch**: `012-react-agent-loop`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Implement Autonomous ReAct Agent Loop with Dynamic Tool Binding so that an agent node can autonomously reason, invoke assigned tools, observe results, and continue until task completion or a step limit—instead of a single model call with tools only usable as manually wired canvas nodes."

---

## Architectural Context & Feature Boundary

### Current Gap
Today an agent step in a workflow makes a single model call. Even when tools are assigned to the agent, those tools are not offered to the model during that step. Operators who need tool use must place separate tool nodes on the canvas and wire them linearly. The platform therefore behaves like a static prompt chain: agents cannot decide mid-task to look something up, call a service, inspect the result, and continue reasoning.

### Scope of This Feature
Make agent steps capable of **bounded autonomous tool use** during a single workflow node execution:

1. **Assigned tools become available to the agent**: When an agent has tools assigned, the model may request those tools during its turn.
2. **Reason–act–observe loop**: The agent may call tools, receive results, and continue reasoning for multiple iterations within one agent node—until it produces a final answer or hits a configured step ceiling.
3. **Secure tool execution**: Every tool invocation goes through the existing secure tool execution path (tenant isolation, credential leasing, authorization). The agent may only use tools explicitly assigned to it.
4. **Live observability**: Intermediate tool starts, completions, and failures appear under the active agent node in the existing in-canvas node inspector without requiring UI redesign.
5. **Operator configuration**: Operators can choose single-turn vs autonomous (ReAct) mode and set a maximum tool-iteration limit for the agent/node.

### Out of Scope
- Changing how standalone tool nodes are authored or wired on the canvas (those remain valid for linear flows).
- Adding new tool types, MCP connectors, or credential providers beyond making existing assigned tools usable inside the agent loop.
- Unbounded or unsupervised agent loops without a hard iteration ceiling.
- Autonomous tool use for non-API / worker-CLI agent adapters in this feature (those remain single-turn unless later extended).
- Redesigning the live canvas inspector UI (existing nested tool-call display must work as-is).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent Uses Assigned Tools Autonomously (Priority: P1)

An operator assigns one or more tools to an agent and runs a workflow whose task requires those tools (for example, “look up user 123 and summarize”). The agent requests the needed tool, receives the result, and returns a final answer—without a separate tool node on the canvas.

**Why this priority**: Closing the gap between “tools assigned” and “tools actually usable” is the core product value of this feature.

**Independent Test**: Configure an agent with a lookup tool, prompt a task that requires that lookup, run the workflow, and verify the agent produces a summary grounded in the tool result without a wired tool node.

**Acceptance Scenarios**:

1. **Given** an agent has at least one tool assigned and is in autonomous mode, **When** the model requests an assigned tool during execution, **Then** the platform executes that tool securely and feeds the result back into the agent’s continuing work.
2. **Given** an agent with assigned tools receives a task that needs those tools, **When** the run completes successfully, **Then** the agent’s final output reflects information obtained from tool results (not only the original prompt).
3. **Given** an agent has tools assigned, **When** the model requests a tool that is not on the agent’s assigned list, **Then** that request is rejected, the agent is told the tool is unavailable, and the run does not grant unauthorized tool access.

---

### User Story 2 - Multi-Step Tool Reasoning Within One Agent Node (Priority: P1)

An operator designs a task that needs more than one tool call in sequence (for example, fetch record A, then use a field from A to query B, then summarize). Within a single agent node, the agent calls the first tool, observes the result, calls the second tool, then produces a final answer.

**Why this priority**: Multi-turn reason–act–observe is what distinguishes an autonomous agent from a one-shot prompt; without it the feature is incomplete.

**Independent Test**: Run a workflow where the correct answer requires two sequential tool uses; confirm both execute under the same agent node and the final answer depends on both results.

**Acceptance Scenarios**:

1. **Given** an agent in autonomous mode with multiple assigned tools, **When** the first tool returns a result, **Then** the agent may issue a subsequent tool request in a later iteration of the same node execution.
2. **Given** a multi-tool task completes within the step limit, **When** the agent produces a final text or structured answer with no further tool requests, **Then** the node completes successfully and that answer is the node’s output.
3. **Given** an individual non-fatal tool failure (timeout, remote error), **When** the failure occurs, **Then** the agent receives an error observation and may retry, choose another approach, or apologize—without immediately failing the whole workflow unless the failure is fatal or a security-policy breach.

---

### User Story 3 - Operators See Nested Tool Activity Live (Priority: P1)

While a run is live on the canvas, an operator selects the active agent node and sees each nested tool call: when it started, arguments (sanitized), outputs or errors, and timing—using the existing node execution inspector.

**Why this priority**: Autonomous loops are opaque without observability; operators must debug and trust tool use without leaving the canvas.

**Independent Test**: Run an agent that invokes tools; open the node inspector on that agent; confirm started/completed/failed tool activity appears under that node in real time.

**Acceptance Scenarios**:

1. **Given** Live Observability is attached to a run, **When** the agent starts a tool call, **Then** a tool-started event is visible for that agent node with tool identity, sanitized input, iteration, and call identity.
2. **Given** a tool call finishes successfully, **When** completion is observed, **Then** a tool-completed event shows sanitized output and duration under the same agent node.
3. **Given** a tool call fails, **When** failure is observed, **Then** a tool-failed event shows a sanitized error under the same agent node.
4. **Given** telemetry or live events are emitted, **When** tool arguments or outputs would contain secrets (API keys, bearer tokens, vault material), **Then** those values are redacted or omitted from event payloads.

---

### User Story 4 - Configure Mode and Step Ceiling (Priority: P2)

An operator opening an agent node’s properties can see assigned tools, choose Single-turn (one model call, no autonomous tool loop) or ReAct / autonomous mode, and set a maximum tool-step limit (bounded range). Defaults match whether tools are assigned.

**Why this priority**: Operators need control and safety knobs; defaults keep simple agents simple while enabling autonomy when tools are present.

**Independent Test**: Open agent properties with and without tools; verify default mode, toggle modes, set max steps within allowed range, save, and confirm a subsequent run honors the settings.

**Acceptance Scenarios**:

1. **Given** an agent has no tools assigned and no explicit mode override, **When** the operator views or runs the agent, **Then** behavior defaults to single-turn.
2. **Given** an agent has one or more tools assigned and no explicit mode override, **When** the operator views or runs the agent, **Then** behavior defaults to autonomous (ReAct) mode.
3. **Given** the operator sets mode to single-turn even with tools assigned, **When** the agent runs, **Then** it performs one model call and does not autonomously execute tools in a loop.
4. **Given** the operator sets a max tool-step value, **When** the value is outside the allowed range (1–10), **Then** the platform clamps or rejects it so only values from 1 through 10 are effective (default 5 when unset).
5. **Given** properties are open for an agent with assigned tools, **When** the operator views the form, **Then** assigned tools are listed for awareness (read-only listing of what the agent may use).

---

### User Story 5 - Safety Stops: Step Limit and Cancel (Priority: P1)

Operators rely on hard limits: the agent cannot loop forever, and Cancel on the live canvas aborts in-flight work immediately—including tool execution inside the loop.

**Why this priority**: Unbounded loops and uncancelable runs are unacceptable for production multi-tenant use.

**Independent Test**: Force an agent to keep requesting tools until the ceiling; confirm graceful halt. Separately, cancel mid-tool-loop and confirm abort without continued tool execution.

**Acceptance Scenarios**:

1. **Given** an agent reaches the configured max tool steps without a final answer, **When** the ceiling is hit, **Then** the node fails closed with a clear limit-exceeded outcome visible to the operator (and does not continue issuing tool calls).
2. **Given** a run is in an agent tool loop, **When** the operator cancels from the live canvas, **Then** in-flight model and tool work abort promptly and no further tool iterations start.
3. **Given** a fatal or security-policy tool failure, **When** it occurs, **Then** the agent node fails closed rather than treating the breach as a recoverable observation.

---

### Edge Cases

- Agent has tools assigned but mode is forced to single-turn → no autonomous tool loop; tools remain unused unless separate tool nodes exist.
- Model requests multiple tools in one response → each assigned tool is executed (in a defined order), observations returned, then the loop continues.
- Model requests an unknown or unassigned tool name → rejected with an error observation; no execution.
- Tool returns empty or large output → agent still receives a usable observation; telemetry remains sanitized and size-safe for the inspector.
- Cancellation arrives between tool calls or during a tool call → loop stops; partial tool results already completed may remain visible in the inspector.
- Provider or model does not support tool calling for the selected model → agent fails with a clear capability error rather than silently ignoring tools (when ReAct mode expects tools).
- Max steps exhausted after successful tool calls but no final prose answer → fail-closed limit-exceeded (not an infinite retry).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an agent runs in autonomous mode with assigned tools, the system MUST make those tools available to the model for the duration of that agent node execution.
- **FR-002**: The system MUST resolve the agent’s assigned tool identifiers against the project’s tool registry and expose only successfully resolved, assigned tools.
- **FR-003**: During autonomous execution, the system MUST run a bounded reason–act–observe loop: invoke the model, execute any authorized tool requests, feed observations back, and repeat until a final answer or the step ceiling.
- **FR-004**: The system MUST treat a model response with no tool requests as the agent’s final output for that node and complete the node successfully when otherwise healthy.
- **FR-005**: Every tool invocation inside the loop MUST go through the platform’s existing secure tool execution path, including tenant isolation and credential leasing when credentials are required.
- **FR-006**: The system MUST refuse tool requests for tools not explicitly assigned to the agent, returning an error observation to the agent without executing the tool.
- **FR-007**: The system MUST enforce a hard maximum tool-iteration count configurable from 1 to 10 inclusive, defaulting to 5 when unset.
- **FR-008**: When the tool-iteration ceiling is reached without a final answer, the system MUST fail closed with a distinct limit-exceeded outcome and stop further tool calls.
- **FR-009**: Non-fatal tool failures MUST be returned to the agent as error observations so the agent can continue the loop; fatal and security-policy failures MUST fail the agent node.
- **FR-010**: Cancellation signaled for the run MUST abort the loop and in-flight tool execution promptly.
- **FR-011**: The system MUST emit tool-started, tool-completed, and tool-failed execution events for each nested tool call, associated with the parent agent node so the existing live inspector can display them.
- **FR-012**: Tool inputs, outputs, and related messages in telemetry and live events MUST be sanitized so secrets (API keys, bearer tokens, vault secrets) do not appear in event payloads.
- **FR-013**: Agents and agent node configuration MUST support an execution mode of `single_turn` or `react`, defaulting to `react` when tools are assigned and `single_turn` when none are assigned (unless explicitly overridden).
- **FR-014**: Agents and agent node configuration MUST support an optional `maxToolSteps` setting clamped to 1–10.
- **FR-015**: The workflow editor agent properties UI MUST let operators view assigned tools, choose single-turn vs ReAct mode, and configure the max tool-step limit.
- **FR-016**: Autonomous tool calling MUST work for all enabled API model providers that the platform already supports for agent execution (OpenAI-, Anthropic-, and Gemini-class models currently offered in the product).
- **FR-017**: This feature’s autonomous loop applies to API-backed agent execution; single-turn behavior remains the baseline when mode is single-turn or when no tools are assigned.

### Key Entities

- **Agent (with tools)**: An agent definition that may list assigned tool identifiers and optional execution mode / max tool-step settings.
- **Agent node configuration**: Per-node overrides for execution mode and max tool steps used when the workflow runs that agent step.
- **Assigned tool**: A tool registry entry the agent is authorized to request during autonomous execution.
- **Tool iteration**: One cycle of model response containing tool requests plus the corresponding tool executions and observations within the agent node.
- **Nested tool execution event**: A started / completed / failed observation tied to the parent agent node for live inspection.
- **Limit-exceeded outcome**: Distinct failure when the agent exhausts `maxToolSteps` without producing a final answer.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In validation scenarios where a correct answer requires one assigned tool, ≥95% of successful runs produce a final agent answer that depends on that tool’s result—without a separate tool node on the canvas.
- **SC-002**: In validation scenarios requiring two sequential tool uses, the same agent node completes both tool uses and a final answer within the configured step limit in ≥90% of successful-path test runs.
- **SC-003**: Unauthorized or unassigned tool requests never result in tool execution (100% blocked in security tests).
- **SC-004**: When max tool steps is set to N, the agent never starts more than N tool-iteration rounds; ceiling exhaustion always surfaces a clear limit-exceeded outcome to the operator.
- **SC-005**: Operators can observe each nested tool call (start, result or error) under the active agent node in the live inspector during a run without leaving the canvas.
- **SC-006**: Cancel from the live canvas stops further tool iterations; no new tool execution starts after cancel is acknowledged in test runs.
- **SC-007**: Sampled live/telemetry payloads for tool arguments and outputs contain no raw API keys, bearer tokens, or vault secrets in automated secret-scan checks.
- **SC-008**: Operators can switch an agent between single-turn and ReAct and set max steps (1–10) from the properties panel; a subsequent run honors those settings without editing the graph topology.

---

## Assumptions

- Existing tool registry entries already carry enough name, description, and input-schema information for models to call them; this feature does not redefine how tools are authored.
- The secure tool execution path, credential leasing, and tenant isolation already used by standalone tool nodes are reused inside the agent loop.
- The in-canvas Node Execution Inspector from live observability already knows how to render nested tool events when those events carry the parent agent `nodeId`; no inspector redesign is required.
- Default max tool steps of 5 balances usefulness and cost; operators who need more can raise up to 10.
- On step-ceiling exhaustion, fail-closed (clear limit-exceeded) is preferred over inventing a synthetic “best effort” final answer, so operators see that the task did not finish cleanly.
- Non-API / worker-CLI agents are out of scope for the autonomous loop in this feature; they keep current single-turn behavior.
- “Tool steps” means rounds of tool-calling model turns (each round may include one or more parallel tool calls), not the count of individual tool invocations alone—documented here so planning can align tests; product copy may say “max tool steps” for operators.
- Provider/model combinations that cannot perform tool calling will fail clearly when ReAct mode expects tools, rather than silently falling back to single-turn.
)
