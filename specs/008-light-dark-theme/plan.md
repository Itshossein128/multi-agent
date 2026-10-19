# Implementation Plan: Light and Dark Appearance

**Branch**: `008-light-dark-theme` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-light-dark-theme/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add one header control that switches the authenticated product between the current dark appearance and a new light appearance, and remember that choice in the browser. Keep dark as the default. Implement light appearance by reversing the existing Tailwind zinc scale under `html[data-appearance="light"]`, plus a small contrast pass for neutral text that is hardcoded white. Do not add a theme library, do not store the choice on the user account, and do not recolor sign-in, registration, or onboarding.

## Technical Context

**Language/Version**: TypeScript 5.7, Next.js 16.3.4, React 19.2

**Primary Dependencies**: Tailwind CSS 4 (`bg-zinc-*` / `text-zinc-*` utilities resolve to `--color-zinc-*`), existing `AppHeader` / `AppShell`, `lucide-react` icons, browser `localStorage`

**Storage**: Browser `localStorage` key `agent-studio.appearance.v1` (`light` or `dark`). No database, cookie, or account field.

**Testing**: Root Jest for the pure preference helper (`tests/appearancePreference.test.ts`, imported via the existing `@/` mapper). Manual browser pass in [quickstart.md](./quickstart.md) for the visual and header flows. `pnpm --filter web exec tsc --noEmit` and `pnpm --filter web build` as the web checks.

**Target Platform**: Studio web app in a desktop and narrow browser window (authenticated organization shell)

**Project Type**: Monorepo web application. This feature is web-only.

**Performance Goals**: The new appearance is visible within 1 second of one header click (SC-001). A saved choice is applied before the first usable paint, or corrected on the next frame if hydration clears it, so the opposite appearance is not shown for a noticeable interval (SC-002).

**Constraints**: Dark remains the untouched default and must stay recognizable. Explicit light and dark only (no operating-system mode). Preference is per browser, not per account or organization. Pages without the application header stay on today’s colors. Switching appearance must not navigate, sign the user out, or clear in-progress input. No new runtime dependency.

**Scale/Scope**: One header control shared by every `AppShell` screen. Light appearance must cover the primary authenticated areas: dashboard, tasks, projects, workspaces, runs, agents, settings, and organization. Zinc utilities dominate those screens (dozens of files); the plan recolors them through CSS variables instead of editing each class.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the Spec Kit placeholder. Applying **de facto Studio gates**:

| Gate | Status | Notes |
|------|--------|-------|
| Prefer existing UI over a new chrome | PASS | Control goes in the existing `AppHeader` right cluster, which every organization screen already renders through `AppShell` |
| YAGNI / minimal surface | PASS | No `next-themes`, no system theme, no account sync, no extra themes, no server API |
| Do not regress current dark appearance | PASS | Dark is the absence of the light override. Existing zinc classes stay as they are when the attribute is `dark` or missing |
| Leave non-shell pages unchanged | PASS | Login, registration, onboarding, and invitations lock the current dark zinc values |
| Browser-local preference, fail closed | PASS | Missing, unreadable, or unknown storage values resolve to dark. Storage failures do not break the page |
| Testable before visual polish | PASS | Preference parse/toggle/persist is a pure helper with Jest coverage. Visual coverage is the quickstart checklist |

**Gate result**: PASS (no unjustified violations). Complexity Tracking left empty.

### Post–Phase 1 re-check

Design keeps the choice in `localStorage`, applies it with `data-appearance` on `documentElement`, recolors shell surfaces by reversing `--color-zinc-*`, and opts non-shell pages out with `appearance-locked`. No account schema, no new route, no theme package. Still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/008-light-dark-theme/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   └── appearance-ui.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/web/src/
├── app/layout.tsx                         # Inline pre-paint script; suppressHydrationWarning on <html>
├── app/globals.css                        # Light zinc scale + .appearance-locked restore
├── app/login/page.tsx                     # Add appearance-locked on the page root
├── app/register/page.tsx                  # Add appearance-locked on the page root
├── app/(authenticated)/onboarding/layout.tsx
├── app/(authenticated)/invitations/page.tsx
├── lib/appearance.ts                      # Pure parse, toggle, read, write
├── components/layout/AppearanceToggle.tsx # Header button
├── components/layout/AppHeader.tsx        # Mount the toggle in the right cluster
└── components/layout/AppShell.tsx         # Subscribe to storage + visibility; keep attribute in sync

tests/
└── appearancePreference.test.ts           # Jest: default, round-trip, invalid value, storage throw
```

**Structure Decision**: Stay inside the Next.js web app. Organization screens already share `AppShell` → `AppHeader`, so one control covers FR-003. Recolor with CSS variables on the existing zinc utilities. A pure helper under `apps/web/src/lib` is tested from root Jest through the current `@/` mapper. Server, shared types, and database migrations are out of this feature.

## Complexity Tracking

> No constitution violations requiring justification.
