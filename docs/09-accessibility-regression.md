# Accessibility Regression Checklist

Run this on `Popup`, `Overlay`, `Sidebar`, `Settings`, and `Onboarding` after UI changes and before release.

## Keyboard

- Move through each surface with `Tab`, `Shift+Tab`, `Enter`, and `Esc`.
- Pass: focus is always visible, follows the visual order, and never traps the user.
- Fail: any primary action becomes unreachable, loses focus visibility, or requires a mouse to continue.

## Contrast

- Review text, icons, borders, badges, and error copy against their backgrounds.
- Pass: `Error States`, `Empty States`, and `Loading States` stay readable without relying on color alone.
- Fail: low-emphasis UI, disabled controls, or overlay chips become hard to read.

## Labels And Semantics

- Confirm buttons, toggles, and inputs have clear visible labels.
- Verify icon-only controls have an accessible name.
- Ensure `Agent Detection` and connection status rows announce useful state, not generic text.
- Keep duplicate actions like `Copy`, `TXT`, and `Markdown` distinguishable by label and purpose.

## Regression Notes

Log the issue with:

- Surface and state, for example `Popup / Reconnecting` or `Overlay / Idle`.
- Exact control or text that failed.
- Input method used, such as keyboard-only or screen reader.
- Expected result versus actual result.
- Browser, OS, and extension version.
- Screenshot or short recording when the issue is visual.
- Current focus path or missing accessible name, if relevant.

## Release Rule

- Do not ship if keyboard operation breaks, contrast drops below readable, or a primary control is unnamed.
