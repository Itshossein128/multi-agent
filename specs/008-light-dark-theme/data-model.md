# Data Model: Light and Dark Appearance

**Feature**: `008-light-dark-theme`  
**Date**: 2026-10-18

This feature stores one browser-local preference. It does not add a database table, an account field, or an organization setting.

## Appearance preference

The selected look for this browser.

| Field | Values | Rules |
|-------|--------|-------|
| Value | `light` or `dark` | No other theme names. No “system” value. |
| Storage key | `agent-studio.appearance.v1` | String in `localStorage`. Not sent as an account attribute. |
| Document attribute | `data-appearance` on `document.documentElement` | Mirrors the resolved value so CSS can switch the zinc scale. |
| Default | `dark` | Used when the key is missing, the value is not exactly `light` or `dark`, or storage cannot be read. |

The preference has no user id, organization id, or timestamp. Two browsers do not share it. Two views in the same browser do.

## Validation

- Read: trim is not required; only the exact strings `light` and `dark` are valid. Empty string, `Light`, `auto`, and any other text resolve to `dark`.
- Write: only `light` or `dark` may be written. A write failure (private mode, disabled storage) leaves the in-memory choice in effect for the current view and does not throw into the header.
- A corrupt value is not rewritten until the person uses the header control. The next successful toggle stores a valid value.

## State transitions

```text
(no key / unreadable / unknown) --> dark
dark -- header control --> light
light -- header control --> dark
```

Transitions update the document attribute and, when storage is available, the stored value. They do not change the route, the session, the organization, or field values on the page.

## Opt-out surfaces

These surfaces do not have their own preference. When the document attribute is `light`, their root uses `appearance-locked`, which restores the dark zinc scale for that subtree only:

- Sign-in
- Registration
- Organization onboarding
- Invitations
- Authenticated not-found outside the organization shell

Organization screens rendered by `AppShell` do not use the lock. They follow the preference, including organization not-found.

## Relationships

- **Application header**: shows the current value and is the only control that changes it.
- **Organization shell**: consumes the document attribute. It does not store a second copy.
- **User account / organization**: no relationship. Changing account or organization does not change the preference.
