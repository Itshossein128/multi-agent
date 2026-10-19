# Research: Light and Dark Appearance

**Feature**: `008-light-dark-theme`  
**Date**: 2026-10-18

## Research questions resolved

### 1. How is the current dark appearance painted?

**Decision**: Treat the dark look as the existing Tailwind zinc utilities (`bg-zinc-950`, `text-zinc-100`, `border-zinc-800`, and the same scale with opacity). Do not introduce a parallel color system for dark mode.

**Rationale**: `AppShell`, `AppHeader`, `AppSidebar`, cards, forms, workflow chrome, and organization pages are written with those utilities. `apps/web/src/app/globals.css` also sets `body` to `#09090b` / `#f4f4f5`, and the shadcn-style HSL tokens in `:root` are already the dark palette. Semantic utilities such as `bg-background` appear on the login and registration pages, not on the authenticated shell. There is no `next-themes` dependency and almost no `dark:` variants.

**Alternatives considered**:
- Rewriting every screen onto `bg-background` / `text-foreground` tokens — correct long-term, and it would touch the majority of `apps/web/src` for a two-value preference. Rejected for this feature because the dark appearance must stay recognizable and the spec forbids a broad redesign.
- A global CSS filter to invert the page — rejected. It would also invert the indigo brand, status colors, and images.

### 2. How should light appearance be applied?

**Decision**: When `html[data-appearance="light"]`, redefine Tailwind’s `--color-zinc-50` through `--color-zinc-950` to the reversed zinc scale, using the literal `oklch` values already shipped in Tailwind CSS 4 (`apps/web/node_modules/tailwindcss/theme.css`). Mapping:

| Token under light appearance | Uses today’s value of |
|------------------------------|------------------------|
| `--color-zinc-50` | `--color-zinc-950` |
| `--color-zinc-100` | `--color-zinc-900` |
| `--color-zinc-200` | `--color-zinc-800` |
| `--color-zinc-300` | `--color-zinc-700` |
| `--color-zinc-400` | `--color-zinc-600` |
| `--color-zinc-500` | `--color-zinc-500` |
| `--color-zinc-600` | `--color-zinc-400` |
| `--color-zinc-700` | `--color-zinc-300` |
| `--color-zinc-800` | `--color-zinc-200` |
| `--color-zinc-900` | `--color-zinc-100` |
| `--color-zinc-950` | `--color-zinc-50` |

Copy the `oklch(...)` literals. Do not assign the variables to each other inside the same rule, or the swap becomes circular.

Also set `html[data-appearance="light"] body` background and text to the light page colors (`oklch` of today’s zinc-50 and zinc-900) so the viewport behind the shell matches.

**Rationale**: Tailwind CSS 4 utilities read `var(--color-zinc-*)`. Opacity utilities (`bg-zinc-950/80`) use `color-mix` against that same variable, so they follow the override without class edits. Page backgrounds (`zinc-950`), cards (`zinc-900` / `zinc-950`), borders (`zinc-800`), and body text (`zinc-100`–`zinc-400`) then flip together. Accent scales (indigo, emerald, red, purple) stay put so primary buttons and status hues do not invert.

**Alternatives considered**:
- `dark:` variants on every class, with light as the unprefixed default — would rewrite the same class strings and would change the default away from today’s dark CSS. Rejected.
- Adding `next-themes` — it solves class toggling and a blocking script, but the spec has no system theme and the app already persists small UI flags in `localStorage` (`app-sidebar-collapsed`). Rejected to avoid a dependency.

### 3. What still needs a manual contrast pass?

**Decision**: After the zinc swap, patch only the neutral text and borders that will not follow it:

- `text-white` and `bg-white` / `text-black` that sit on zinc surfaces (for example the “AGENT STUDIO” wordmark and headings on `bg-zinc-*`). Change those to zinc text utilities so the swap paints them dark on light and light on dark.
- Leave `text-white` on saturated controls (`bg-indigo-600`, gradient marks) so those labels stay white in both appearances.
- Leave `bg-black/70` scrims. They remain readable over both appearances.
- Review accent text that is used as the only label on a zinc surface (`text-indigo-300`, `text-indigo-400`, `text-emerald-400` on a page background). Where contrast fails on the light page, add a light-appearance override for that specific utility (darker indigo / emerald), not a full accent-scale reversal.
- Dark status chips (`bg-emerald-950`, `bg-red-950`, toast backgrounds) may stay dark islands. Change one only if the quickstart pass finds its text unreadable.

**Rationale**: A global remap of `text-white` would make indigo button labels disappear. A global remap of emerald/red would turn intentional status color into its opposite. The zinc swap covers the bulk of FR-004 and FR-012; the pass covers the leftovers the swap cannot see.

**Alternatives considered**:
- Invert every palette, not only zinc — rejected because brand and status colors would flip.
- Accept white wordmarks on the light header — rejected. They fail FR-012 on the first screen the user sees.

### 4. Where does the control live, and how does it behave?

**Decision**: Add one button, `AppearanceToggle`, in the right side of `AppHeader`, before the divider and `UserMenu`. It is present on every organization screen because those screens render `AppShell`. The button stays visible at narrow widths (no `hidden` / `md:flex` gate).

Visible label is the current appearance: “Dark” or “Light”, at every breakpoint, with a Moon icon for dark and a Sun icon for light. Accessible name states the current appearance and the appearance activation will select, for example “Dark appearance, switch to light”. `aria-pressed` is true only while light is active. Activation calls the pure toggle helper and does not navigate or reset form state.

**Rationale**: FR-001 and FR-003 are one control on the shared header. FR-009 and FR-010 need a visible current state, a keyboard button, and a name that screen readers can announce. Neighboring header items already hide their labels on small screens; this control cannot, or the narrow-screen scenario fails.

**Alternatives considered**:
- Icon only, with the icon meaning “switch to the other appearance” — common, but the spec asks a sighted user to see which appearance is active. Rejected as the only indicator.
- A control per page header (`runs/[runId]`, agent detail) — those pages already sit under `AppHeader`. Rejected as duplicate controls.

### 5. How is the choice stored and restored?

**Decision**: Storage key `agent-studio.appearance.v1`. Legal values are the strings `light` and `dark`. Anything else, a missing key, or a storage exception resolves to `dark` and leaves the previous bad value unused. Writing uses the same try/catch pattern as `AppShell`’s sidebar flag.

A pure module `apps/web/src/lib/appearance.ts` owns parse, toggle, read, and write. `AppShell` applies the value to `document.documentElement.dataset.appearance`. The root layout includes a tiny inline script that reads the same key and sets the attribute before paint, and `<html>` uses `suppressHydrationWarning`. `AppShell` re-asserts the attribute in `useLayoutEffect` so a hydration pass that clears it is corrected on the next frame.

Other open tabs: listen for the `storage` event on that key, and re-read when the document becomes visible. The tab that writes the value updates itself immediately.

**Rationale**: Matches FR-006, FR-007, and FR-008 without an account field. The sidebar already treats `localStorage` as best-effort UI state. The script plus layout effect is enough for SC-002 without a cookie. A cookie was rejected because this preference must not become request state or an account setting.

**Alternatives considered**:
- `useEffect`-only restore — flashes the dark shell for returning light users. Rejected as the only mechanism.
- Cookie read in the server layout — removes the flash completely, but sends the preference on every request. Rejected.
- `next-themes` blocking script — same outcome as the inline script, plus an unused system-theme API. Rejected.

### 6. How do pages without the application header stay unchanged?

**Decision**: Put the zinc override on `html[data-appearance="light"]` so portaled UI (the root `Toaster`) and the shell share it. Pages that do not render `AppHeader` add `appearance-locked` on their root. That class, only under the light attribute, restores the original zinc `oklch` values and the current body colors for that subtree:

- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/register/page.tsx`
- `apps/web/src/app/(authenticated)/onboarding/layout.tsx`
- `apps/web/src/app/(authenticated)/invitations/page.tsx`
- `apps/web/src/app/(authenticated)/not-found.tsx` (outside the organization shell)

Organization `not-found` stays inside `AppShell` and follows the selected appearance.

**Rationale**: The spec leaves sign-in, registration, and every other page without the application header on today’s colors. Onboarding and invitations are authenticated but do not use `AppShell`. Scoping the override only to `AppShell` would leave the toaster and any portal on the dark scale while the shell is light, and it would make the pre-paint script on `<html>` useless. Locking the opt-out subtrees keeps one attribute and a clear exception list.

**Alternatives considered**:
- Override variables only on `AppShell` — login would stay dark automatically, but the pre-paint attribute on `<html>` would not color the shell until React committed, and body/toaster would disagree with the shell. Rejected.

### 7. What is explicitly not researched further?

**Decision**: No operating-system `prefers-color-scheme` listener, no per-user database column, and no high-contrast theme. Workflow canvas and dashboard graphs follow the zinc utilities they already use; hardcoded accent strokes stay. A formal WCAG audit is out of scope; the quickstart checks that text and controls stay visually distinct on the primary screens.

**Rationale**: These match the spec assumptions. Reopening them would widen the feature.
