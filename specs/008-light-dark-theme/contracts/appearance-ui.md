# UI Contract: Appearance

**Feature**: `008-light-dark-theme`  
**Date**: 2026-10-18

No HTTP endpoint is added. This contract is the header control, the document attribute, and the storage value described in [data-model.md](../data-model.md).

## Document attribute

| Attribute | Element | Values |
|-----------|---------|--------|
| `data-appearance` | `html` | `dark` (default) or `light` |

- Set before first paint from `localStorage` when the key is the exact string `light` or `dark`.
- Missing, unknown, or unreadable storage sets `dark`.
- `html[data-appearance="light"]` reverses the zinc scale as specified in [research.md](../research.md).
- `html[data-appearance="dark"]` and a missing attribute leave today’s zinc values and body colors in place.

## Opt-out class

| Class | Effect |
|-------|--------|
| `appearance-locked` | Under `html[data-appearance="light"]` only, restores the original zinc scale and the current dark body colors for that element and its descendants. |

Apply it to the root of sign-in, registration, organization onboarding, invitations, and authenticated not-found outside the organization shell. Do not apply it to `AppShell`.

## Header control

Rendered once inside the application header’s right-hand actions, on every screen that uses that header. Visible at desktop and narrow widths.

| Property | Contract |
|----------|----------|
| Element | `button type="button"` |
| Visible label | `Dark` when the resolved value is dark. `Light` when it is light. |
| Icon | Moon while dark. Sun while light. Decorative (`aria-hidden`). |
| Accessible name | `Dark appearance, switch to light` or `Light appearance, switch to dark`, matching the resolved value. |
| `aria-pressed` | `true` when the resolved value is `light`; otherwise `false`. |
| Activation | Pointer click or keyboard (Enter / Space on the focused button) switches to the other value. |
| Side effects | Updates the document attribute and attempts to store the new value. Does not change the URL, submit a form, or clear inputs. |

The control is not shown on pages that do not render the application header.

## Storage

| Key | `agent-studio.appearance.v1` |
|-----|------------------------------|
| Write | Exact `light` or `dark` after a successful toggle. |
| Read | Exact `light` or `dark`; otherwise resolve `dark`. |
| Cross-view | Another view in the same browser adopts a new value on the `storage` event and when it becomes visible. |

## Out of contract

- Operating-system appearance
- Account or organization persistence
- Additional theme names
- Recoloring locked pages
- A second toggle outside the application header
