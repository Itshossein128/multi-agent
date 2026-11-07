# Feature Specification: Retrieval Step

**Feature Branch**: `019-retrieval-node`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, Finding 7: add a Vector Retrieval step that visually queries the organization’s existing semantic long-term memory, within scopes the designer is allowed to read, and passes ranked results to later steps."

---

## Architectural Context & Feature Boundary

### Current Gap
The product already stores semantic long-term memory for an organization, but a workflow cannot ask that memory a question as a visual step. The existing memory step reads and writes named keys for the run. It does not search saved knowledge by meaning, and designers cannot ground a later agent or prompt in retrieved passages without leaving the canvas.

### Scope of This Feature
Add a **Retrieval** step that:

1. Searches semantic memory the designer is allowed to read in the current organization.
2. Uses a question the designer typed or the value arriving at the step.
3. Returns a ranked list of matching passages, or a clear empty result.
4. Does not create, change, or delete memory.
5. Never returns another organization’s memory.

### Out of Scope
- Building a new memory store, embedding pipeline, or memory browser.
- Writing, forgetting, or consolidating memory from this step. The existing memory step remains the key-based read/write step.
- Uploading documents into memory.
- Cross-organization or public web search.
- Calling a model inside the retrieval step. Later steps may read the retrieved passages.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ground a Later Step in Saved Knowledge (Priority: P1)

A designer adds a Retrieval step, chooses a memory scope they can read, and sets the question to either a fixed phrase or the text arriving from the previous step. On a run, the step result is a ranked list of matching passages from that scope. A following step can use those passages. If nothing matches, the step succeeds with an explicit empty list unless the designer required at least one match.

**Why this priority**: Returning authorized matches to the rest of the workflow is the reason to put retrieval on the canvas.

**Independent Test**: Seed two passages in an allowed scope, query for one of them, and confirm the step returns that passage ranked above an unrelated passage, or returns an explicit empty list for a nonsense query. Confirm a following output step receives that result.

**Acceptance Scenarios**:

1. **Given** the step palette, **When** the designer adds a Retrieval step, **Then** they can choose an allowed memory scope and a question source (typed text or the incoming step value).
2. **Given** matching memory in the chosen scope, **When** the workflow runs, **Then** the step result is a ranked list that includes the relevant passage and excludes passages from scopes that were not selected.
3. **Given** no matching passage, **When** the designer did not require a hit, **Then** the step succeeds with an empty list that later steps can recognize as empty.
4. **Given** the designer required at least one hit and none match, **When** the step runs, **Then** the step fails with a clear “nothing retrieved” reason and does not invent a passage.

---

### User Story 2 - Stay Inside Allowed Memory (Priority: P1)

A designer can only search memory their organization role already allows them to read. A query must not return another organization’s passages, even when the text is identical. A scope they cannot read is not offered, and a saved step whose scope they lose access to fails closed on the next run.

**Why this priority**: Semantic search that crosses tenants or roles would be a serious data leak. The step is not shippable without this boundary.

**Independent Test**: Store the same sentence in two organizations. Run the retrieval step in the first. Confirm only the first organization’s passage is returned. Then remove the designer’s access to the chosen scope and confirm the next run fails closed.

**Acceptance Scenarios**:

1. **Given** identical passages in two organizations, **When** a designer runs retrieval in one organization, **Then** the result contains only that organization’s passage.
2. **Given** memory scopes the designer cannot read, **When** they configure the step, **Then** those scopes are not selectable.
3. **Given** a saved step whose scope the designer can no longer read, **When** the workflow runs, **Then** the step fails with an authorization message and returns no passages.
4. **Given** a successful retrieval, **When** memory is reviewed afterward, **Then** no passage was created, edited, or deleted by the step.

---

### User Story 3 - Understand What Was Retrieved (Priority: P2)

An operator opens the retrieval step on a live or finished run and sees the question that was used, the scope, how many passages came back, and the passages themselves or the empty/failure reason. They can tell a bad query from an authorization failure.

**Why this priority**: Retrieval is opaque if the run only shows a blob. Inspection can follow the safe search behavior.

**Independent Test**: Run one successful query, one empty query, and one unauthorized query. Confirm each run’s step detail shows question, scope, and outcome in language an operator can distinguish.

**Acceptance Scenarios**:

1. **Given** a finished retrieval step, **When** the operator inspects it, **Then** they see the question used, the scope, and the ranked passages or an explicit empty result.
2. **Given** an authorization failure, **When** the operator inspects the step, **Then** the reason is distinct from “no matches.”
3. **Given** a long passage list, **When** the operator inspects the step, **Then** they can read the returned set without the studio dropping passages that were actually returned to later steps.

---

### Edge Cases

- The incoming question is blank and the designer required it: the step fails before search and does not run an empty query that would match broadly.
- The scope contains many near-duplicates: the result is still ranked and capped at a documented maximum, and the cap is visible so designers know the list may be incomplete.
- A passage is deleted after the designer saved the step but before the run: the run simply does not return it.
- Two retrieval steps in one workflow: each uses its own scope and question.
- The designer asks for more results than the maximum: validation or the run caps the list at the maximum and records that the cap applied.
- Live mode shows the step running, succeeded with a count, or failed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workflow palette MUST include a Retrieval step that searches the organization’s existing semantic memory.
- **FR-002**: Designers MUST be able to choose a memory scope they are allowed to read and MUST NOT be able to select a scope they cannot read.
- **FR-003**: The question MUST be either text saved on the step or the value arriving at the step.
- **FR-004**: A successful search MUST return a ranked list of passages from the chosen scope only, up to a visible maximum count the designer can set within the product maximum.
- **FR-005**: An empty authorized search MUST be distinguishable from a failure. It succeeds with an empty list unless the designer required at least one passage, in which case the step fails with a no-match reason.
- **FR-006**: A blank required question MUST fail the step before search.
- **FR-007**: Retrieval MUST NOT create, update, or delete memory.
- **FR-008**: Results MUST NOT include another organization’s memory, even when the text matches.
- **FR-009**: If access to the saved scope is gone at run time, the step MUST fail closed with an authorization reason and MUST NOT return passages.
- **FR-010**: Operators MUST be able to see the question, scope, result count, passages or empty state, and any failure reason on the run.
- **FR-011**: The existing key-based memory step MUST keep its current read and write behavior. Retrieval does not replace it.
- **FR-012**: Workflows that do not use a Retrieval step MUST keep their current behavior.

### Key Entities

- **Retrieval Step**: A canvas step that asks a question of one allowed memory scope and returns ranked passages.
- **Memory Scope**: An existing body of semantic memory inside the organization that a designer is allowed to read.
- **Question**: Typed text or the incoming step value used for the search.
- **Retrieved Passage**: One ranked memory item returned to later steps, including enough text for a later step to use it.
- **Retrieval Outcome**: Matches, explicit empty, no-match failure, or authorization failure, recorded on the run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 4 of 5 designers add a retrieval step, query an allowed scope, and pass either a relevant passage or an explicit empty list to the next step on the first attempt.
- **SC-002**: In a two-organization test with identical passage text, 100% of runs return only the calling organization’s passage.
- **SC-003**: 100% of checklist runs leave stored memory unchanged.
- **SC-004**: Operators distinguish “no matches,” “match required but absent,” and “not allowed” from the step detail in at least 90% of internal walkthroughs.
- **SC-005**: 100% of checklist queries against a scope the designer cannot read return no foreign passages and fail closed.

## Assumptions

- Semantic long-term memory already exists for the organization, including the access rules that decide who may read a scope. This feature is a workflow step over that memory, not a new memory product.
- The existing memory step continues to read and write named run keys. Retrieval is search-only.
- Ranking uses the product’s current semantic search behavior. This spec does not redefine how similarity is calculated.
- A default result cap on the order of a small list (for example 5, with a product maximum such as 20) is enough for v1. The exact cap is a planning detail as long as it is finite and visible.
- The step does not call a model. Whatever the existing memory capability already does to search stays inside that capability and must not widen who can read memory.
- Later steps consume the retrieval result through the workflow’s normal step output. Named variable references are optional and come from the data-mapping feature when that feature exists.
- Document upload, deletion, and memory administration stay in their existing surfaces.
