# Agent Execution Runbook

This repository is meant to be executed by multiple LLM agents in parallel. The goal is to reduce coordination overhead by making dependencies explicit and limiting overlap.

## Execution Model

Use a single coordinator agent plus parallel worker agents.

- Coordinator: owns scope, dependency order, merges, and conflict resolution.
- Worker agents: own one workstream each and avoid editing outside assigned files.
- Each worker develops in its own branch.
- Each worker merges through a pull request into `main`.
- The coordinator coordinates branch assignment and PR sequencing.

Recommended workstreams:

1. Product agent: `docs/01-product.md`
2. Architecture agent: `docs/02-architecture.md`
3. UI/UX agent: `docs/03-ui-ux-spec.md`
4. Engineering agent: `docs/04-engineering.md`
5. Backlog agent: `docs/05-backlog.md`

## Dependency Gates

The following items should be stabilized first:

- Vision, problem statement, personas, and user stories
- Core architecture contract: extension, adapter, WebSocket, storage
- Primary UI surfaces: overlay, sidebar, popup, settings

After those gates are stable, workers can proceed in parallel on implementation detail, test strategy, and backlog expansion.

## Parallelization Rules

- One agent owns one file at a time unless the coordinator approves a merge.
- Avoid editing the same section from two agents simultaneously.
- Use explicit handoffs when a document changes shared terminology.
- Prefer additive edits over rewrites when another worker may already be operating.
- If a task introduces a new contract, update the corresponding architecture or engineering doc in the same pass.

## Release/QA Queue Split

When the coordinator reaches the release-and-QA slice, use the queue index in `docs/05-backlog.md` and launch Queue 5 as a 5-worker batch.

- Worker 1: packaging and versioning
- Worker 2: security and local-only enforcement
- Worker 3: performance and reconnect stability
- Worker 4: QA smoke, regression, and post-release verification
- Worker 5: accessibility and supportability

Queue 5 should be assigned with one branch and one PR per worker. Keep the queue numbering aligned with `docs/07-agent-prompts.md` so the backlog, runbook, and prompt pack all name the same batch.

## Task Packet Format

Assign work to agents using this structure:

```text
Task ID:
File(s):
Goal:
Inputs:
Dependencies:
Deliverable:
Validation:
```

Example:

```text
Task ID: B3-04
File(s): docs/02-architecture.md, docs/05-backlog.md
Goal: Define partial transcript handling.
Inputs: WebSocket protocol, state machine, transcript model.
Dependencies: B3-01, B3-02
Deliverable: Updated protocol notes and backlog item.
Validation: Partial transcript flow is deterministic and testable.
```

## Recommended Split

- Agent A: product scope and acceptance criteria
- Agent B: architecture and protocol contracts
- Agent C: UI states and wireframes
- Agent D: engineering rules, tests, and release process
- Agent E: backlog decomposition and dependency tagging

## Merge Policy

- Merge only after the coordinator checks for terminology drift.
- If two edits overlap semantically, choose the version that better matches the product goals and document the reason.
- Keep a short change log in the affected doc when a major contract changes.
- Use one branch per agent or workstream, for example `agent/product`, `agent/architecture`, `agent/ui`, `agent/engineering`, `agent/backlog`.
- Open a PR for each branch against `main`.
- Do not merge directly to `main` without a PR review pass.
