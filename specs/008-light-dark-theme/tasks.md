---
description: "Task list for Light and Dark Appearance"
---

# Tasks: Light and Dark Appearance

**Input**: Design documents from `/specs/008-light-dark-theme/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/appearance-ui.md, quickstart.md

**Tests**: TDD and Playwright were requested. Write each story's tests first and confirm they fail before that story's implementation. Jest covers the preference helper. Playwright covers the header control, persistence, primary screens, and accessibility.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Web UI: `apps/web/src/`
- Styles: `apps/web/src/app/globals.css`
- Playwright: `apps/web/e2e/` (`apps/web/playwright.config.ts`, `testDir: ./e2e`)
- Jest: `tests/` importing `@/lib/appearance` through the existing `@/` mapper
- Feature docs: `specs/008-light-dark-theme/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the design and the existing web/Playwright toolchain before any feature code

- [x] T001 Confirm feature docs complete under `specs/008-light-dark-theme/` (`plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/appearance-ui.md`, `quickstart.md`) and note feature id `008-light-dark-theme`
- [x] T002 [P] Confirm `apps/web/playwright.config.ts` already runs `testDir: ./e2e` with the chrome project, and leave `apps/web/package.json` without a new theme package (`next-themes` stays absent)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared appearance preference helper and the Playwright sign-in helper that every story uses

**WARNING: CRITICAL**: No user story work can begin until this phase is complete

### Tests (write first)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T003 [P] Write failing Jest coverage in `tests/appearancePreference.test.ts` for `apps/web/src/lib/appearance.ts` (module may be absent, so the suite fails until T004). Assert these rules verbatim from `specs/008-light-dark-theme/data-model.md`: value is exactly `light` or `dark` (no other theme names, no `system` value); storage key is `agent-studio.appearance.v1`; default is `dark` when the key is missing, the value is not exactly `light` or `dark`, or storage cannot be read; only the exact strings `light` and `dark` are valid (`""`, `Light`, and `auto` resolve to `dark`); `writeAppearance` accepts only `light` or `dark` and a storage throw does not propagate; a corrupt stored value is left unchanged by a read

### Implementation

- [x] T004 Implement `parseAppearance`, `toggleAppearance`, `readAppearance`, and `writeAppearance` in `apps/web/src/lib/appearance.ts` with exported `APPEARANCE_STORAGE_KEY = "agent-studio.appearance.v1"` and `Appearance = "light" | "dark"`, until `tests/appearancePreference.test.ts` passes. `toggleAppearance("dark")` returns `light` and `toggleAppearance("light")` returns `dark`. `readAppearance` uses `getItem` and resolves invalid or thrown reads to `dark` without rewriting the corrupt value. `writeAppearance` calls `setItem` only with `light` or `dark` and swallows storage exceptions
- [x] T005 [P] Add `registerAndOpenOrganization(page)` to `apps/web/e2e/appearance-helpers.ts` that follows the sign-up and create-organization flow in `apps/web/e2e/organization-routing.spec.ts` and returns the organization slug. Do not assert appearance in this helper

**Checkpoint**: Preference rules are green in Jest, and Playwright specs can open an organization shell

---

## Phase 3: User Story 1 - Switch the app between dark and light (Priority: P1) MVP

**Goal**: A header control switches the current organization shell between dark and light immediately, without a reload, a route change, or losing typed text

**Independent Test**: Open any organization screen, activate the header control once, and confirm header, navigation, and page background change from dark to light and back. The URL and in-progress text stay put

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [US1] Write a failing Playwright spec in `apps/web/e2e/appearance-toggle.spec.ts` using `registerAndOpenOrganization` from `apps/web/e2e/appearance-helpers.ts`. On `/o/{slug}/projects`, expect a `button` with `data-testid="appearance-toggle"` inside `header`. First visit with the storage key absent expects `html` `data-appearance` of `dark` or absent, and a dark `document.body` background (mean RGB channel under 50). One click sets `data-appearance="light"` within 1 second, keeps the same URL, and makes `document.body` background light (mean RGB channel over 200). Clicking again sets `data-appearance="dark"` and the dark body background. Open the header **Launch Agent Task** dialog, type a unique sentence, activate the toggle, and expect that sentence and the dialog to remain

### Implementation for User Story 1

- [x] T007 [P] [US1] In `apps/web/src/app/globals.css`, under `html[data-appearance="light"]`, set `--color-zinc-50` through `--color-zinc-950` to the reversed Tailwind zinc `oklch` literals from `specs/008-light-dark-theme/research.md` (copy literals; do not alias the variables to each other). Set that selector's `body` background to today's zinc-50 `oklch(98.5% 0 none)` and body text to today's zinc-900 `oklch(21% 0.006 285.885)`. Leave `html[data-appearance="dark"]` and a missing attribute on the current zinc scale
- [x] T008 [P] [US1] Create `apps/web/src/components/layout/AppearanceToggle.tsx` as a `button type="button"` with `data-testid="appearance-toggle"`. Clicking it calls `toggleAppearance` and `writeAppearance` from `apps/web/src/lib/appearance.ts` and sets `document.documentElement.dataset.appearance` to the new value. It does not navigate or clear inputs
- [x] T009 [US1] Render `AppearanceToggle` once in the right-hand cluster of `apps/web/src/components/layout/AppHeader.tsx`, before the vertical divider and `UserMenu`, with no `hidden` breakpoint class
- [x] T010 [US1] In `apps/web/src/components/layout/AppShell.tsx`, read the stored appearance with `readAppearance` on mount and set `document.documentElement.dataset.appearance` so client navigation keeps the choice made by `AppearanceToggle`. Do not add the cross-tab listeners here (that is US2)

**Checkpoint**: US1 is independently testable — one header click flips the shell, and typed text survives. `pnpm --filter web test:e2e -- e2e/appearance-toggle.spec.ts` passes

---

## Phase 4: User Story 2 - Keep the chosen appearance (Priority: P1)

**Goal**: The last explicit choice is restored on reload and in other views of the same browser. Unknown storage falls back to dark. Pages without the application header stay on today's colors

**Independent Test**: Choose light, reload, and open another tab; both show light. Choose dark and the other view follows. A stored value of `blue` opens dark. Sign-in stays dark while the shell is light

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T011 [US2] Write a failing Playwright spec in `apps/web/e2e/appearance-persistence.spec.ts`. Cover: missing `agent-studio.appearance.v1` opens `/o/{slug}/projects` dark; choosing light then reloading shows `data-appearance="light"` on the first assertion (no multi-second dark flash); a second page in the same browser context opens light; toggling the second page to dark updates the first page's `data-appearance` without a click there; storing exactly `blue` and reloading resolves to dark and leaves the control usable; with `light` stored, `/login`, `/register`, `/onboarding/organization`, and `/invitations` have no `appearance-toggle` and their `appearance-locked` root keeps a dark background (mean RGB channel under 50)

### Implementation for User Story 2

- [x] T012 [P] [US2] In `apps/web/src/app/layout.tsx`, set `suppressHydrationWarning` on `<html>` and add an inline script that runs before paint, reads `agent-studio.appearance.v1`, and sets `data-appearance` to `light` or `dark`. Any thrown read or any value other than the exact strings `light` and `dark` sets `dark`
- [x] T013 [P] [US2] In `apps/web/src/components/layout/AppShell.tsx`, re-assert `data-appearance` in `useLayoutEffect` from `readAppearance`, listen for `storage` events on `agent-studio.appearance.v1`, and re-read when the document becomes visible so another view's choice is adopted
- [x] T014 [P] [US2] Add `appearance-locked` to the page root in `apps/web/src/app/login/page.tsx`
- [x] T015 [P] [US2] Add `appearance-locked` to the page root in `apps/web/src/app/register/page.tsx`
- [x] T016 [P] [US2] Add `appearance-locked` to the wrapper in `apps/web/src/app/(authenticated)/onboarding/layout.tsx`
- [x] T017 [P] [US2] Add `appearance-locked` to the page root in `apps/web/src/app/(authenticated)/invitations/page.tsx`
- [x] T018 [P] [US2] Add `appearance-locked` to the page root in `apps/web/src/app/(authenticated)/not-found.tsx`. Do not add it to `apps/web/src/app/(authenticated)/o/[orgSlug]/not-found.tsx` or `apps/web/src/components/layout/AppShell.tsx`
- [x] T019 [US2] In `apps/web/src/app/globals.css`, under `html[data-appearance="light"] .appearance-locked`, restore the original Tailwind zinc `--color-zinc-50` through `--color-zinc-950` literals and the current dark body colors `#09090b` and `#f4f4f5` for that subtree

**Checkpoint**: US2 is independently testable on top of the US1 control. `pnpm --filter web test:e2e -- e2e/appearance-persistence.spec.ts` passes

---

## Phase 5: User Story 3 - Read and use the whole app in light appearance (Priority: P1)

**Goal**: Light appearance covers header, navigation, content, forms, and dialogs on the primary organization screens, and dark appearance still matches today's product

**Independent Test**: Switch to light and visit dashboard, tasks, projects, workspaces, runs, agents, settings, and organization. Each screen's header, navigation, and main content are light and readable. Switching back restores dark

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T020 [US3] Write a failing Playwright spec in `apps/web/e2e/appearance-surfaces.spec.ts`. After choosing light, visit `/o/{slug}`, `/o/{slug}/tasks`, `/o/{slug}/projects`, `/o/{slug}/workspaces`, `/o/{slug}/runs`, `/o/{slug}/org/agents`, `/o/{slug}/settings`, and `/o/{slug}/organization`. On each, expect `header`, `aside#app-sidebar`, and `main` to stay on a light background (mean RGB channel over 180) and expect their text color to stay dark (mean RGB channel under 80). Open **Launch Agent Task** and expect the dialog panel background to be light. Then switch to dark and expect those same three regions to return to a dark background (mean RGB channel under 60) with light text (mean RGB channel over 180)

### Implementation for User Story 3

- [x] T021 [P] [US3] In `apps/web/src/components/layout/AppHeader.tsx`, `apps/web/src/components/layout/AppSidebar.tsx`, and `apps/web/src/components/layout/UserMenu.tsx`, replace `text-white` that sits on zinc surfaces with `text-zinc-100`. Keep `text-white` on `bg-indigo-600` and gradient marks
- [x] T022 [P] [US3] Apply the same zinc-surface `text-white` replacement in `apps/web/src/components/dashboard/StatCards.tsx`, `apps/web/src/components/dashboard/CompletedAndCostSection.tsx`, `apps/web/src/components/dashboard/QueueAndFailedSection.tsx`, `apps/web/src/components/dashboard/RunningAgentsSection.tsx`, `apps/web/src/components/dashboard/GraphFlowPreview.tsx`, and `apps/web/src/components/dashboard/graph/GraphAgentNode.tsx`
- [x] T023 [P] [US3] Apply the same replacement in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx` and `apps/web/src/components/workflow/EditorToolbar.tsx`
- [x] T024 [P] [US3] Apply the same replacement in `apps/web/src/components/tasks/TaskDetailPanel.tsx`, `apps/web/src/components/tasks/detail/ClarificationPanel.tsx`, `apps/web/src/components/tasks/detail/TaskCommentsSection.tsx`, `apps/web/src/components/tasks/detail/StatusActions.tsx`, and `apps/web/src/components/tasks/CreateTaskModal.tsx`
- [x] T025 [P] [US3] Apply the same replacement in `apps/web/src/app/(authenticated)/o/[orgSlug]/projects/page.tsx`, `apps/web/src/app/(authenticated)/o/[orgSlug]/projects/[projectId]/page.tsx`, `apps/web/src/app/(authenticated)/o/[orgSlug]/workspaces/page.tsx`, `apps/web/src/app/(authenticated)/o/[orgSlug]/workspaces/[workspaceId]/page.tsx`, `apps/web/src/app/(authenticated)/o/[orgSlug]/webhooks/page.tsx`, `apps/web/src/app/(authenticated)/o/[orgSlug]/routines/page.tsx`, `apps/web/src/app/(authenticated)/o/[orgSlug]/not-found.tsx`, and `apps/web/src/components/agents/AgentHeartbeatPanel.tsx`. Leave sign-in, registration, and onboarding colors unchanged
- [x] T026 [P] [US3] In `apps/web/src/app/globals.css`, add `html[data-appearance="light"]` overrides only for accent text that is the sole label on a zinc surface (`text-indigo-300`, `text-indigo-400`, `text-emerald-400`) so it uses a darker step of the same hue. Do not reverse indigo, emerald, red, or purple scales. Leave `bg-black/70` scrims and dark status chips (`bg-emerald-950`, `bg-red-950`) as they are unless `apps/web/e2e/appearance-surfaces.spec.ts` shows their text unreadable

**Checkpoint**: US3 is independently testable. `pnpm --filter web test:e2e -- e2e/appearance-surfaces.spec.ts` passes, and dark still matches the pre-feature shell

---

## Phase 6: User Story 4 - Understand and operate the header control (Priority: P2)

**Goal**: The header control shows the current appearance, has an accessible name, works from the keyboard, and stays visible on a narrow screen

**Independent Test**: Focus the control with the keyboard and with a screen reader name check in both appearances, activate it with Enter and Space, and repeat at a 390px viewport

### Tests for User Story 4

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T027 [US4] Write a failing Playwright spec in `apps/web/e2e/appearance-toggle-a11y.spec.ts`. Expect the visible button text to be `Dark` while dark and `Light` while light. Expect the accessible name `Dark appearance, switch to light` or `Light appearance, switch to dark` to match the current value. Expect `aria-pressed="true"` only while light, and `aria-pressed="false"` while dark. Expect the Moon/Sun icon to be `aria-hidden="true"`. Focus the button and press Enter, then Space, and expect the appearance to change each time. At viewport `390x844`, expect the same button to be visible and still switch appearance

### Implementation for User Story 4

- [x] T028 [P] [US4] Update `apps/web/src/components/layout/AppearanceToggle.tsx` so the visible label is `Dark` or `Light`, the icon is Moon or Sun from `lucide-react` with `aria-hidden`, the accessible name is `Dark appearance, switch to light` or `Light appearance, switch to dark`, and `aria-pressed` is `true` only when the resolved value is `light`. Keep `data-testid="appearance-toggle"` and `type="button"`
- [x] T029 [P] [US4] In `apps/web/src/components/layout/AppHeader.tsx`, keep `AppearanceToggle` outside every `hidden`, `sm:`, and `md:` visibility wrapper so the label remains visible at `390px` width

**Checkpoint**: US4 is independently testable. `pnpm --filter web test:e2e -- e2e/appearance-toggle-a11y.spec.ts` passes

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Run the full automated and manual checks from the quickstart

- [x] T030 [P] Run `pnpm test -- tests/appearancePreference.test.ts --runInBand` from the repository root and fix failures in `apps/web/src/lib/appearance.ts` or `tests/appearancePreference.test.ts`
- [x] T031 [P] Run `pnpm --filter web exec tsc --noEmit` and fix type errors in the appearance files under `apps/web/src/`
- [x] T032 Run `pnpm --filter web test:e2e -- e2e/appearance-toggle.spec.ts e2e/appearance-persistence.spec.ts e2e/appearance-surfaces.spec.ts e2e/appearance-toggle-a11y.spec.ts` and fix failing specs or product code
- [x] T033 Walk through `specs/008-light-dark-theme/quickstart.md` sections 1–8 in the browser and fix any remaining gap in `apps/web/src/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational
- **Polish (Phase 7)**: Depends on the user stories you intend to ship

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational. No dependency on US2–US4. This is the MVP
- **User Story 2 (P1)**: Starts after US1, because reload and cross-view tests use the header control. Storage rules themselves live in the foundational helper
- **User Story 3 (P1)**: Starts after US1, because it needs the light zinc scale and the toggle. It does not need US4's accessible name
- **User Story 4 (P2)**: Starts after US1, because it tightens `AppearanceToggle` and `AppHeader`. It does not need the surface contrast pass

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- US1: Playwright spec (T006) before CSS (T007) and the toggle (T008). Header mount (T009) after the component. Shell sync (T010) after the component
- US2: Playwright spec (T011) before the script, listeners, locked roots, and locked CSS
- US3: Playwright spec (T020) before the `text-white` edits and accent overrides
- US4: Playwright spec (T027) before the accessible-name and layout edits

### Parallel Opportunities

- T002 can run with T001
- T003 and T005 can run in parallel. T004 waits on T003
- After T006, T007 and T008 can run in parallel. T009 waits on T008. T010 waits on T008
- After T011, T012–T018 can run in parallel. T019 waits until those class names are in place so the CSS selector matches real roots
- After T020, T021–T025 can run in parallel. T026 can run with them (different concern, same `globals.css` as no other US3 task)
- After T027, T028 and T029 can run in parallel
- T030 and T031 can run in parallel. T032 follows, then T033

---

## Parallel Example: User Story 1

```bash
# Test first (must fail):
Task: "Write failing Playwright spec in apps/web/e2e/appearance-toggle.spec.ts"

# Then, together:
Task: "Reverse zinc variables in apps/web/src/app/globals.css"
Task: "Create AppearanceToggle in apps/web/src/components/layout/AppearanceToggle.tsx"
```

## Parallel Example: User Story 2

```bash
# Test first (must fail):
Task: "Write failing Playwright spec in apps/web/e2e/appearance-persistence.spec.ts"

# Then, together:
Task: "Inline pre-paint script in apps/web/src/app/layout.tsx"
Task: "Storage and visibility listeners in apps/web/src/components/layout/AppShell.tsx"
Task: "appearance-locked on login, register, onboarding, invitations, and authenticated not-found"
```

## Parallel Example: User Story 3

```bash
# Test first (must fail):
Task: "Write failing Playwright spec in apps/web/e2e/appearance-surfaces.spec.ts"

# Then, together:
Task: "Replace zinc-surface text-white in layout, dashboard, workflow, tasks, and organization pages"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (Jest preference helper must pass)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: `pnpm --filter web test:e2e -- e2e/appearance-toggle.spec.ts`
5. Demo the header switch on an organization screen

### Incremental Delivery

1. Setup + Foundational → preference rules and sign-in helper ready
2. User Story 1 → immediate light/dark switch (MVP)
3. User Story 2 → reload, cross-view, invalid storage, locked pages
4. User Story 3 → primary screens and contrast
5. User Story 4 → name, keyboard, narrow viewport
6. Polish → Jest, typecheck, all four Playwright specs, quickstart sections 1–8

### Parallel Team Strategy

After Foundational and User Story 1:

- Developer A: User Story 2
- Developer B: User Story 3
- Developer C: User Story 4

US2 and US3 both edit `apps/web/src/app/globals.css`. Land those CSS edits in separate hunks (locked-scale restore vs accent overrides) to avoid a silent overwrite.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing each story
- Storage key is exactly `agent-studio.appearance.v1`. Legal stored values are exactly `light` and `dark`
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
