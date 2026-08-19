# Agent Note: Structured plan form and durable plan document

Status: implemented

English | [中文](2026-08-15-plan-form-durable-plan-document.zh.md)

## Problem

Plan mode could only receive one-shot input through `/plan <message>` and one final `exit_plan_mode` review. There was no structured back-and-forth for clarifying requirements, and the submitted plan existed only in `tool/call.arguments`. The plan document was not durably recoverable from the session log, and interactions could not be associated with the final plan.

## Decision

`@deepseek-ai/dsh-plan-mode` now registers `plan_form` beside `exit_plan_mode`. `plan_form` is always advertised but executes only in active plan mode; it sends one structured planning form through `ctx.userQuestions`, logs `plan/form/request` and `plan/form/answer` events, and returns the structured answers. `exit_plan_mode` now appends a whole-value `plan/document` event on submit (`proposed`), approval (`approved`), or rejection (`rejected`), with the same `planId` and `sourceEventSeqs` citing the form events that shaped it.

The `plan-document` session projection folds every `plan/document` into a `{ latest, revisions }` value for UI and cold reads. `planId` is `plan-<seq>` for the first document and reused for later revisions. `dsh-client-ui-plan` renders a collapsible plan-document dock in `conversation.input.dock` with the latest markdown and the revision list. `AskUserQuestionIntent` gains a presentation-only `plan-form` variant; the Web question composer renders it with form chrome (title, step progress, submit label) while keeping the generic flow answerable. When `dsh-permission-presets` is composed, plan-mode also registers the optional `/plan-readonly` bridge that enters plan mode and switches the session preset to `read-only`. The new `dsh-plan-spec` package persists spec documents as whole-value `spec/document` events, and `dsh-task-basis` captures plan/spec seq bases for long-running-task conflict checks.

## Testing

- Plan-mode unit and integration tests cover form request/answer logging, dismissal, tool schema, and document append on submit/approve.
- Projection tests cover the `plan-document` key and latest-document fold.
- UI composer tests cover `plan-form` routing, progress, and submit.
- Tool-catalog test updated for the new `plan_form` schema.

## Alternatives considered

**Reuse `ask_user_question` only.** Rejected because plan mode needs logged, plan-associated interaction records, not just an in-conversation question.

**Store plans in files.** Rejected because the session log is the durable home for reconstructable collaboration state.

## Consequences

- Plan mode gains structured clarification rounds without changing `plan/mode` semantics.
- Plans survive resume/fork and are linked to their form interactions by seq and id.
- The Web composer shows the latest plan document and its revision history without leaving the conversation.
- The optional `/plan-readonly` bridge gives deployments a one-key read-only planning switch without making plan state read or write sandbox policy.
- Older readers skip the new `ignorable` events; `SESSION_FORMAT_VERSION` stays at `0`.
