# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: four-column/two-row AppFrame plus the existing `ctx.layout` panel-geometry service and additive `ctx.workspaceLayout` service. It registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, `shell.workspace.right`, `shell.workspace.bottom`, and `shell.overlay`. Sidebar spans both rows; Bottom exists only below Conversation; Right and Details span both rows. The sidebar resize boundary is an invisible hit strip, while Details and workspace separators expose accessible resize handles. A closed sidebar retains its control rail, an attached closed workspace retains a 44px rail, and Details closes to zero width.

The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame keeps Conversation, both workspace occupants, and Details mounted across dock concessions, Sheet projection, and Pane maximization. A connected Session renders through `SessionProvider`. `ctx.workspaceLayout.attach(ownerId, preference)` admits exactly one live owner and returns an update/subscribe/dispose handle; owner disposal removes the 44px rail and every workspace reservation.

Right defaults to 480px (360–840px and at most 60% of the main region), Bottom defaults to 34% (180px–65%), and Conversation targets a 420×320px readable floor. If docking cannot preserve that floor, the active Pane becomes a Sheet whose left edge remains at or to the right of the actual sidebar. Right and Details use last-explicit-open priority and recover their stored preferences when space returns. Pane maximization hides but does not unmount other surfaces, and Escape restores the prior layout.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, `WorkspaceLayoutController`, the two layout service faces, workspace preference/snapshot/handle types, and the owner-share interfaces. AppFrame and the panel store remain package-internal; the pure workspace solver is available from its `/src` test/development path.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and Details closed; switching between distinct Session ids also closes Details and forgets its dragged width, while unselected surfaces render Details at zero width without modifying geometry.
- **Concession auto-close is derived** — Right and Details restore when space returns; consumers must not treat stored preferences as rendered truth.
- **Workspace persistence belongs to the attached owner** — `ctx.workspaceLayout` itself is transient; a Pane owner must persist only its safe canonical presentation state and must not restore temporary maximization.
- **Only one workspace owner may attach** — competing docking runtimes fail during load rather than sharing or replacing the current tracks.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
