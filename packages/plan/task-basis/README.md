# @deepseek-ai/dsh-task-basis

English | [中文](README.zh.md)

Long-running-task basis capture and conflict detection over the session log. `ctx.taskBasis.capture(session, taskId)` records the latest `plan/document` seq and `spec/document` seqs before a task starts; `ctx.taskBasis.check(session, taskId)` compares that basis with the current fold and appends a `task/conflict` verdict.

Versions are session event seqs: monotonic, whole-log, and reconstructable after resume/fork without adding revision fields to every document type.

## API

- `ctx.taskBasis.capture(session, taskId)` — append `task/basis`.
- `ctx.taskBasis.check(session, taskId)` — append `task/conflict` with `safe` or `needs-merge`.
- `foldPlanSeq(events)` / `foldSpecSeqs(events)` / `foldTaskBasis(events, taskId)` / `foldTaskConflict(events, taskId)` — pure folds for tests and projections.

## Model Experience

`task/basis` and `task/conflict` are log-only; they never enter model history. A caller can feed a conflict verdict back to the model as an ordinary tool result.

#### KV Cache effect

No direct invalidation; consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **`needs-merge` is the only non-safe verdict today** — `blocked` requires scope intersection data from the task and plan/spec change, which the future task-basis policy layer should provide.
- **No automatic merge** — the service derives and persists the conflict; resolving it is the caller's policy.
