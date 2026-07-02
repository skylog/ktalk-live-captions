# Accessibility Regression Checklist

Use this checklist during release verification when reviewing the main surfaces: `Popup`, `Overlay`, `Sidebar`, `Settings`, and `Onboarding`.

## Check Keyboard Focus

- Move through each surface with `Tab`, `Shift+Tab`, `Enter`, and `Esc`.
- Confirm focus is visible on every interactive control.
- Verify the focus order matches the visual order and does not trap the user.
- Check that primary actions remain reachable in `Popup`, `Sidebar`, and `Overlay`.

## Check Contrast And Readability

- Review text, icons, borders, and status chips against their backgrounds.
- Confirm important states remain readable in `Error States`, `Empty States`, and `Loading States`.
- Pay special attention to low-emphasis UI, disabled controls, and overlay chips.
- If a state relies on color, verify there is also a text label or structural cue.

## Check Labels And Semantics

- Confirm buttons, toggles, and inputs have clear visible labels.
- Verify ARIA labels or equivalent accessible names on icon-only controls.
- Ensure status rows in `Agent Detection` and connection/error sections announce meaningful state, not generic text.
- Check that duplicate controls like `Copy`, `TXT`, and `Markdown` are distinguishable by label and purpose.

## What To Record On Regression

Log the issue with:

- Surface and state, for example `Popup / Reconnecting` or `Overlay / Idle`.
- Exact control or text that failed.
- Input method used, such as keyboard-only or screen reader.
- Expected result versus actual result.
- Browser, OS, and extension version.
- Screenshot or short recording when the issue is visual.
- If relevant, the current focus path or missing accessible name.

## Release Rule

- Do not ship if a regression blocks keyboard operation, removes readable contrast, or leaves a primary control unnamed.
