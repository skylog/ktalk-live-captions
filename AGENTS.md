# Repository Guidelines

## Project Structure & Module Organization

This repository is currently documentation-first. The main source-of-truth files are:
- `PRD.md` for product scope and goals
- `ARCHITECTURE.md` for system boundaries and data flow
- `TASKS.md` for implementation checklist and work tracking

When code is added, keep runtime code and extension assets in clearly named top-level folders such as `src/`, `extension/`, or `assets/`. Keep generated output out of source folders and document any new directory in `ARCHITECTURE.md`.

## Build, Test, and Development Commands

No build or test scripts are defined yet in this repository. When you add tooling, document the exact commands here and keep them reproducible, for example:
- `npm run build` for production builds
- `npm test` for automated tests
- `npm run dev` or `npm run watch` for local development

If a command depends on a local service such as `localhost:8000/asr`, note the prerequisite in the relevant doc.

## Coding Style & Naming Conventions

Use clear, descriptive names for extension components and services, such as `content-script`, `service-worker`, and `transcript-store`. Prefer ASCII filenames unless a broader convention already exists. Keep Markdown headings short and structured. For code, follow the formatter and linter chosen by the implementation stack, and commit the configuration alongside the code.

## Testing Guidelines

No automated test framework is configured yet. Add tests alongside the code they cover, with names that describe behavior, such as `transcript-store.test.ts` or `overlay.spec.ts`. Prioritize coverage for connection handling, transcript persistence, reconnect logic, and export paths.

## Commit & Pull Request Guidelines

The Git history is minimal, so there is no established commit convention yet. Use concise imperative commit subjects, for example: `Add transcript export flow`. Pull requests should include:
- a short summary of the change
- the related task or issue
- screenshots or short clips for UI work
- notes on local verification, especially for extension and localhost integration

## Agent-Specific Instructions

Before making implementation changes, update `TASKS.md` if the scope changes. Keep the local captioning pipeline local-only unless the product docs are intentionally revised.

For parallel LLM execution, prefer `docs/06-agent-runbook.md` and assign one agent per file or workstream. Treat `docs/05-backlog.md` as the source of truth for dependency ordering.

Each agent should work on its own branch and merge changes through a pull request into `main`. Avoid direct commits to `main` for agent-driven work.
