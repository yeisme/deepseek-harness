# @deepseek-ai/dsh-plan-spec

English | [中文](README.zh.md)

Durable plan-spec documents. `spec/document` is a log-only, whole-value-replace `SessionEventMap` member keyed by `specId` and owned by `planId`; the latest write wins and earlier writes retain the revision history. `ctx.planSpec` owns the write path, and the optional `spec-document` projection unit serves `{ latest, revisions, byPlan }` when `ctx.sessionProjections` is composed.

Specs are not filesystem artifacts: they live in the session log, so resume, fork, and compaction recover them like plan documents. Each revision records `basisPlanRevision` and `basisSpecVersions`, giving future task-basis checks the facts they need to detect long-running-task conflicts.

## API

- `ctx.planSpec.write(session, input)` — append the next revision; `input` requires `specId`, `planId`, `title`, `content`, `basisPlanRevision`, and optional `status`/`basisSpecVersions`.
- `ctx.planSpec.current(session, specId)` — fold the latest revision for one spec.
- `ctx.planSpec.list(session, planId?)` — fold latest specs grouped by plan, then specId.

## Model Experience

Spec events are log-only and never enter model history. A model reads/writes specs only through tools or injected context built from the projection, so each new spec adds no prompt tokens by itself.

#### KV Cache effect

No direct invalidation; consumers that render spec context own any request-prefix changes.

## Known Limitations and Deferred Work

- **No plan ownership validation** — `write` does not require the referenced `planId` to exist in `plan/document`; the task-basis layer can enforce that when it lands.
- **No conflict engine yet** — basis facts are persisted but consumers must compare them.
