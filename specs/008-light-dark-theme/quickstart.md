# Quickstart: Light and Dark Appearance

**Feature**: `008-light-dark-theme`  
**Date**: 2026-10-18

Validation guide for the header control and the two appearances. Preference rules are in [data-model.md](./data-model.md). Control and attribute rules are in [contracts/appearance-ui.md](./contracts/appearance-ui.md).

## Prerequisites

- Web app running (`pnpm dev:web`, port 3060).
- A signed-in user who can open an organization shell (dashboard and the other primary areas).
- Browser devtools available for storage and a narrow viewport.

## Automated check

From the repository root, after the preference helper and its test exist:

```text
pnpm test -- tests/appearancePreference.test.ts --runInBand
```

Expected:

- Missing storage resolves to dark.
- `light` and `dark` round-trip.
- Any other stored string resolves to dark.
- A storage read or write failure resolves or no-ops without throwing.
- Toggle from dark yields light, and toggle from light yields dark.

Then:

```text
pnpm --filter web exec tsc --noEmit
```

Expected: no type errors in the web app.

## 1. Default is dark

1. Clear `agent-studio.appearance.v1` for the app origin.
2. Open an organization dashboard.

Expected: the shell matches today’s dark appearance. The header control reads **Dark**. `html` has `data-appearance="dark"` (or the light override is not active).

## 2. Switch to light and back

1. On the dashboard, activate the header control once.
2. Confirm the URL did not change.
3. Activate it again.

Expected:

- The first activation shows a light page, header, and navigation within one second, and the control reads **Light** with `aria-pressed="true"`.
- The second activation restores the dark appearance and the control reads **Dark**.
- Keyboard: focus the control with Tab and activate it with Enter or Space. The appearance changes the same way.

## 3. In-progress input survives

1. Open a screen with a text field (task create, settings, or the header launch dialog).
2. Type a unique sentence and do not submit.
3. Activate the appearance control.

Expected: the sentence, the open dialog, and the current screen remain.

## 4. Choice survives reload and a later visit

1. Switch to light.
2. Reload the page.
3. Open a new tab to another organization screen (projects or settings).
4. Switch to dark in the second tab, then focus the first tab.

Expected:

- Reload and the new tab open on light, without a long flash of dark.
- The first tab shows dark after it becomes active again.
- Both tabs share one value. `localStorage["agent-studio.appearance.v1"]` is `light` or `dark` matching the control.

## 5. Invalid storage falls back to dark

1. Set `agent-studio.appearance.v1` to `blue`.
2. Reload an organization screen.

Expected: dark appearance, control still works, and the next toggle stores `light` or `dark`.

## 6. Primary screens follow the choice

With light selected, open each area and check the header, navigation, and main content. Then repeat on dark.

- Dashboard
- Tasks
- Projects
- Project workspaces
- Runs (list and an open run, if one exists)
- Agents
- Settings
- Organization

Expected: no large region left on the opposite appearance. Text, buttons, fields, menus, and dialogs stay visually distinct from their backgrounds. Indigo primary buttons keep white labels. The dark pass still looks like the current product.

## 7. Narrow header

1. Narrow the window until the header compresses (below the sidebar breakpoint).
2. Find the appearance control.

Expected: the control is still visible, shows Dark or Light, and switches appearance.

## 8. Pages without the application header stay as they are

With `agent-studio.appearance.v1` set to `light`, open:

- Sign-in
- Registration
- Organization onboarding
- Invitations

Expected: those pages keep today’s dark colors. Returning to an organization screen is still light.

## Done when

- Sections 1–8 match the expected results.
- The Jest preference test passes.
- Web typecheck passes.
