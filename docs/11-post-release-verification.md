# Post-Release Verification

Use this checklist after a release build is published or merged. Run it in a clean Chromium profile so prior extension state does not mask regressions.

## Before You Start

- Record the build version from `manifest.json` and the commit SHA used for the release.
- Use a fresh Chromium profile with no other extensions enabled.
- Confirm the local ASR service is available at `localhost:8000`.

## Verification Steps

1. Install the unpacked extension from the current build output.
2. Open the popup and start captions.
3. Open the meeting tab and confirm the overlay appears, the sidebar session starts, and transcript text begins to accumulate.
4. Stop the local ASR service, wait for the UI to enter `reconnecting`, then start the service again.
5. Confirm captions recover without reinstalling the extension or clearing profile data.
6. Produce a short transcript, then export both TXT and Markdown from the sidebar.

## Expected Outcomes

- Installation completes in the clean profile without permission loops or missing assets.
- Start transitions from idle to active and shows a live session in overlay and sidebar.
- Reconnect resolves automatically after the service returns.
- TXT and Markdown exports download successfully and contain the current session content.

## Record Results

- Build version and commit SHA
- Chromium version and profile used
- Any failure with surface, step, expected result, actual result, and screenshot or log if available
- Regression status: `pass`, `warning`, or `fail`
