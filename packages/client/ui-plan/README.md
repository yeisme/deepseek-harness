# @deepseek-ai/dsh-client-ui-plan

English | [中文](README.zh.md)

Plan-mode status control and plan-document dock, a pure browser surface plugin. The browser half occupies the conversation-declared `conversation.input.plan` single seat (to the right of the access-mode control) and the `conversation.input.dock` list with a collapsible plan-document strip; the node half is an empty apply (the roster row). Plan behavior itself — the `/plan` command, the boundary-or-idle-committed `plan/mode` state, the `plan` projection unit, and the policy section — is owned by [`@deepseek-ai/dsh-plan-mode`](../../plan/plan-mode/README.md), composed independently on the host roster.

Plan mode is entered through the `/plan` command path: users can choose Plan from the composer's `+` Command menu, type `/plan`, or click the inactive Plan entry chip rendered by this package. While the host-computed `plan` projection's effective target is plan mode (`pending ? !active : active` — a folded host value, not client optimism, so an arriving frame corrects the chip either way), the seat renders the warn-colored "Plan ×" status button, which executes `/plan off` through `command.execute`. While the effective target is the steady default mode, the seat renders a neutral "Plan" entry button that executes `/plan`; a pending exit leaves the seat empty until the projection confirms the switch. A host without plan-mode (or a Draft with no session) shows nothing. While plan mode is the effective target, the composer textarea's placeholder switches to the plan-task hint — "describe your task to generate plan", localized through ui-conversation's `conversation` locale namespace (the `placeholder.plan` / `hint.plan` keys) and shared verbatim with the claimed `/plan` command hint (rendered by the composer from the same projection; owner-supplied placeholders win).

The active chip carries the accessible description "Plan mode on, press to turn off"; the entry chip carries "Plan mode off, press to turn on". Admission failures (`matched: false`, business errors, transport faults) surface as an inline error and the chip stays until the projection confirms the switch.

The model exits plan mode through the stable `exit_plan_mode` tool; its plan review uses the composed Web question channel.

The plan-document dock supports inline editing: the edit button opens a Markdown editor, and saving persists the new title/body as a new `plan/document` revision through `/plan-edit`; when the current plan is approved/executing/completed, the old document is first marked `superseded`. When a compatible Pane Workbench service is present, the dock exposes one action that opens the Plan content in the shared workspace. The Pane's own chrome remains responsible for docking, moving, maximizing, and closing the view. This package never registers a second conversation sidebar or a page-covering fullscreen overlay.

The contextual Plan Pane is organized for execution scanning rather than long-form reading first: plan status/title/round/mode, task completion and localized task states, selectable plan options, plan Markdown, linked goal, then a collapsed revision history. Option selection reports pending, failure, and selected states locally while `/plan-select` remains the durable owner. The view removes a leading Markdown heading when it repeats the plan title, so the shared Pane tab and the plan content do not produce stacked duplicate chrome.

## Model Experience

Indirectly, through the `/plan` and `/plan off` command lines the chips dispatch: `@deepseek-ai/dsh-plan-mode` owns the model-visible policy section, the exit-tool schema, and the logged state those lines drive, while this package only renders the projection and sends what a user could equally type.

#### KV Cache effect

Entering or leaving plan mode changes the active `plan:policy` system-prompt section and therefore the request prefix; the chip itself adds no prompt content.

## Known Limitations and Deferred Work

- **Plan mode is guidance, not an execution sandbox** — deployments that require enforced read-only planning must compose the independent sandbox and approval policies; the optional `/plan-readonly` bridge switches both once when `dsh-permission-presets` is composed.
- **The chip belongs to the default composer** — a pending whole-composer interaction such as plan review temporarily replaces the InputBar and its chip.
- **The plan-document dock is compact** — full markdown appears only when expanded; the dock hides while no `plan/document` exists. The richer Plan view is an optional contextual Pane and remains unavailable when no compatible Pane provider is installed. Pane layout commands such as maximize belong to the shared workbench chrome, not to duplicate controls in the dock.
