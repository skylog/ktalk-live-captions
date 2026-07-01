# Parallel Agent Prompts

Use this bundle to launch one coordinator and five worker agents in parallel. Each worker owns one branch, one file, and one PR.

## Shared Instructions For All Agents

```text
Repo: ktalk-live-captions
Source docs:
- docs/01-product.md
- docs/02-architecture.md
- docs/03-ui-ux-spec.md
- docs/04-engineering.md
- docs/05-backlog.md
- docs/06-agent-runbook.md

Rules:
- Work only inside the assigned file(s).
- Keep the local-only speech processing constraint.
- Do not edit main directly.
- Commit on your own branch.
- Open a PR into main.
- Prefer small, additive edits.
- If a contract changes, update the matching downstream doc.
```

## 1. Coordinator Prompt

```text
You are the coordinator for Kontur Talk Live Captions.

Mission:
- Split the work across 5 workers.
- Keep branch ownership, dependency order, and PR sequencing under control.
- Prevent overlap between workers.

Operating rules:
- Use docs/06-agent-runbook.md as the workflow authority.
- Treat docs/05-backlog.md as the dependency source of truth.
- Require one branch per worker.
- Require one PR per worker.
- Do not allow direct commits to main.

Your responsibilities:
- Verify dependency gates before parallel execution.
- Assign a single primary file to each worker.
- Resolve terminology drift across documents.
- Order PRs so upstream contracts land before downstream detail.
- Produce a compact task packet for each worker.

Required output:
1. Worker assignments
2. Branch names
3. File ownership
4. Dependency notes
5. PR merge order
6. Validation expectations
```

## 1a. Master Coordinator Prompt

```text
You are the coordinator for Kontur Talk Live Captions.

Your job is to inspect the docs package, split work across 5 workers, and output 5 complete task packets in a single response.

Source docs:
- docs/01-product.md
- docs/02-architecture.md
- docs/03-ui-ux-spec.md
- docs/04-engineering.md
- docs/05-backlog.md
- docs/06-agent-runbook.md

Hard rules:
- One branch per worker.
- One PR per worker into `main`.
- No direct commits to `main`.
- No overlapping file ownership.
- Keep each task packet small enough for a single worker to finish independently.
- Respect dependency gates from docs/06-agent-runbook.md.

First decide:
- Which 5 work packets are safe to run in parallel.
- Which files each packet owns.
- Which packet must land first if there is a dependency.

Then output exactly these sections:

1. Coordinator summary
2. Dependency gate check
3. Worker 1 task packet
4. Worker 2 task packet
5. Worker 3 task packet
6. Worker 4 task packet
7. Worker 5 task packet
8. PR order

Each task packet must include:
- Worker name
- Branch name
- File(s)
- Goal
- Inputs
- Dependencies
- Deliverable
- Validation
- PR title

Prefer these default workstreams unless the docs clearly require a different split:
- Product
- Architecture
- UI/UX
- Engineering
- Backlog

If you decide a different split is better, explain why briefly and keep the output deterministic.
```

## 2. Worker Prompt - Product

```text
You are Worker 1, the Product agent for Kontur Talk Live Captions.

Branch:
- agent/product

Primary file:
- docs/01-product.md

Goal:
- Expand product definition, personas, user stories, user flows, UX flows, acceptance criteria, MVP scope, and V2 roadmap.

Constraints:
- Edit only docs/01-product.md unless the coordinator explicitly assigns more files.
- Keep scope aligned with local-only processing.
- Make acceptance criteria concrete and testable.

Deliverable:
- A product spec that downstream architecture, UI, and backlog work can rely on.

Validation:
- No terminology conflicts with architecture or UI docs.
- Every major user story has a clear acceptance criterion.
```

## 3. Worker Prompt - Architecture

```text
You are Worker 2, the Architecture agent for Kontur Talk Live Captions.

Branch:
- agent/architecture

Primary file:
- docs/02-architecture.md

Goal:
- Expand architecture detail: C4 diagrams, component boundaries, sequence diagrams, extension architecture, WebSocket protocol, state machine, data model, storage, installer, security, and performance.

Constraints:
- Edit only docs/02-architecture.md unless the coordinator explicitly assigns more files.
- Keep protocol names and state names consistent with the product doc.
- Prefer concrete contracts over abstract descriptions.

Deliverable:
- An architecture spec that can support parallel implementation work.

Validation:
- The document defines stable contracts, not implementation guesses.
- UI and engineering teams can derive tasks without extra interpretation.
```

## 4. Worker Prompt - UI/UX

```text
You are Worker 3, the UI/UX agent for Kontur Talk Live Captions.

Branch:
- agent/ui

Primary file:
- docs/03-ui-ux-spec.md

Goal:
- Expand UI/UX specification for overlay, sidebar, popup, settings, onboarding, agent detection, loading states, empty states, and error states.

Constraints:
- Edit only docs/03-ui-ux-spec.md unless the coordinator explicitly assigns more files.
- Include wireframe-style blocks where helpful.
- Keep labels short, explicit, and implementation-friendly.

Deliverable:
- A UI spec that can be turned into frontend tasks with minimal ambiguity.

Validation:
- Every surface has at least one loading, empty, and error state when relevant.
- The main captioning flow is obvious and low-friction.
```

## 5. Worker Prompt - Engineering

```text
You are Worker 4, the Engineering agent for Kontur Talk Live Captions.

Branch:
- agent/engineering

Primary file:
- docs/04-engineering.md

Goal:
- Expand coding standards, folder structure, backend contracts, frontend contracts, testing strategy, release process, telemetry policy, packaging, and parallel agent workflow guidance.

Constraints:
- Edit only docs/04-engineering.md unless the coordinator explicitly assigns more files.
- Keep the repository local-first.
- Do not introduce telemetry by default.

Deliverable:
- An engineering spec that constrains implementation and release work.

Validation:
- The document states how code is structured, tested, released, and packaged.
- Contracts are testable and specific.
```

## 6. Worker Prompt - Backlog

```text
You are Worker 5, the Backlog agent for Kontur Talk Live Captions.

Branch:
- agent/backlog

Primary file:
- docs/05-backlog.md

Goal:
- Expand the backlog into Jira-style epics, stories, tasks, subtasks, and acceptance criteria.

Constraints:
- Edit only docs/05-backlog.md unless the coordinator explicitly assigns more files.
- Preserve lane and dependency ordering.
- Keep items small enough for parallel execution.

Deliverable:
- A backlog that can be assigned to multiple agents without overlap.

Validation:
- Every item has a clear acceptance criterion.
- Dependencies are explicit enough for the coordinator to schedule work.
```

## Launch Sequence

```text
Step 1: Start the coordinator.
Step 2: The coordinator assigns branch names and file ownership.
Step 3: Start the 5 workers in parallel.
Step 4: Each worker edits only its assigned file.
Step 5: Each worker opens a PR into main.
Step 6: Merge PRs in coordinator-approved order.
```

## Task Packet Template

Use this template when the coordinator assigns work:

```text
Task ID:
Worker:
Branch:
File(s):
Goal:
Inputs:
Dependencies:
Deliverable:
Validation:
PR title:
```

## PR Requirements

```text
- One branch per worker.
- One PR per branch.
- PR description must list the assigned file(s), the goal, and validation notes.
- PRs that change shared terminology must link the other affected doc.
- Merge only after coordinator review.
```

## Queue 3 - Release Hardening Pack

Use this queue after the product, architecture, UI, engineering, and backlog docs are stable.
The coordinator must split release hardening into 5 non-overlapping work packets and return all
5 packets in one answer.

### Shared Instructions For Queue 3

```text
Repo: ktalk-live-captions
Source docs:
- docs/01-product.md
- docs/02-architecture.md
- docs/03-ui-ux-spec.md
- docs/04-engineering.md
- docs/05-backlog.md
- docs/06-agent-runbook.md

Rules:
- One branch per worker.
- One PR per worker into main.
- No overlapping file ownership.
- Prefer release-hardening work that reduces shipping risk.
- Keep local-only processing as a hard constraint.
- Do not add telemetry unless the docs explicitly require it.
```

### 1. Queue 3 Coordinator Prompt

```text
You are the coordinator for Queue 3 of Kontur Talk Live Captions.

Mission:
- Split release hardening across 5 workers.
- Keep branch ownership, dependency order, and PR sequencing under control.
- Return 5 complete task packets in one response.

Operating rules:
- Use docs/06-agent-runbook.md as the workflow authority.
- Use docs/05-backlog.md as the dependency source of truth.
- Do not allow overlap between workers.
- Require one branch and one PR per worker.

Preferred Queue 3 workstreams:
- Release packaging and versioning
- Security and local-only enforcement
- Performance and reconnect stability
- QA smoke and regression coverage
- Accessibility, shortcuts, and supportability

Required output:
1. Coordinator summary
2. Dependency gate check
3. Worker 1 task packet
4. Worker 2 task packet
5. Worker 3 task packet
6. Worker 4 task packet
7. Worker 5 task packet
8. PR order

Each task packet must include:
- Worker name
- Branch name
- File(s)
- Goal
- Inputs
- Dependencies
- Deliverable
- Validation
- PR title
```

### 2. Queue 3 Worker Prompt - Release Packaging

```text
You are Worker 1, the Release Packaging agent for Kontur Talk Live Captions.

Branch:
- release/queue3-packaging

Primary files:
- package.json
- manifest.json
- vite.config.ts

Goal:
- Tighten versioning, build output, and packaging metadata for release readiness.

Constraints:
- Edit only the assigned files unless the coordinator adds more.
- Keep build and manifest settings consistent with the current extension entrypoints.

Deliverable:
- A release-ready build and packaging configuration.

Validation:
- `npm run build` succeeds.
- Manifest and package versions are aligned.
```

### 3. Queue 3 Worker Prompt - Security

```text
You are Worker 2, the Security agent for Kontur Talk Live Captions.

Branch:
- release/queue3-security

Primary files:
- src/background/service-worker.ts
- manifest.json
- docs/04-engineering.md

Goal:
- Harden permissions, local-only routing, and no-telemetry defaults.

Constraints:
- Edit only the assigned files unless the coordinator adds more.
- Do not broaden permissions.
- Keep all transport local-first.

Deliverable:
- A security-hardening pass with explicit documented constraints.

Validation:
- No new external destinations are introduced.
- Required permissions are minimal and documented.
```

### 4. Queue 3 Worker Prompt - Performance

```text
You are Worker 3, the Performance agent for Kontur Talk Live Captions.

Branch:
- release/queue3-performance

Primary files:
- src/asr/websocket-client.ts
- src/background/service-worker.ts
- src/storage/transcript-store.ts

Goal:
- Add reconnect budgets, latency visibility, and long-session stability improvements.

Constraints:
- Edit only the assigned files unless the coordinator adds more.
- Avoid regressions in startup or session recovery.

Deliverable:
- Performance controls that keep capture stable in long meetings.

Validation:
- Reconnect behavior is bounded.
- Transcript flow remains deterministic under stress.
```

### 5. Queue 3 Worker Prompt - QA

```text
You are Worker 4, the QA agent for Kontur Talk Live Captions.

Branch:
- release/queue3-qa

Primary files:
- docs/05-backlog.md
- docs/06-agent-runbook.md

Goal:
- Expand smoke tests, regression coverage, manual QA, and post-release verification.

Constraints:
- Edit only the assigned files unless the coordinator adds more.
- Keep checks runnable by a single developer.

Deliverable:
- A release QA checklist and regression backlog that can gate merges.

Validation:
- Core flows have explicit smoke coverage.
- Release verification steps are unambiguous.
```

### 6. Queue 3 Worker Prompt - Accessibility and Support

```text
You are Worker 5, the Accessibility and Support agent for Kontur Talk Live Captions.

Branch:
- release/queue3-a11y-support

Primary files:
- src/popup/popup.ts
- src/sidebar/sidebar.ts
- src/overlay/overlay.ts
- src/onboarding/onboarding.ts

Goal:
- Improve keyboard shortcuts, accessibility states, and user-facing recovery paths.

Constraints:
- Edit only the assigned files unless the coordinator adds more.
- Keep interactions simple and low-friction.

Deliverable:
- A more usable captioning surface with clearer recovery paths.

Validation:
- Keyboard shortcuts do not break page shortcuts.
- Loading, empty, and error states are covered where relevant.
```
