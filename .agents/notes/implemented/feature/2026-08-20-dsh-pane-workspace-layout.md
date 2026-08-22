# Agent Note: DSH Pane workspace joins the canonical layout

Status: implemented

English | [中文](2026-08-20-dsh-pane-workspace-layout.zh.md)

## Problem

The extension workbench previously mounted through `shell.overlay`. It covered the canonical DSH session sidebar and introduced a second page structure competing with the conversation, Tool Details, files, terminals, and artifact previews. The workspace needed to participate in AppFrame layout without fixed offsets, DOM selectors, or global margins.

## Decision

`@deepseek-ai/dsh-client-ui-layout` owns two root-scoped single slots:

- `shell.workspace.right`
- `shell.workspace.bottom`

AppFrame solves a four-column, two-row layout. The DSH session sidebar spans both rows, the conversation occupies the main column's upper row, the Bottom workspace occupies only its lower row, and the Right workspace and Tool Details each span both rows. A dock, Sheet, or maximized workspace never starts left of the actual sidebar edge.

Extensions attach through `ctx.workspaceLayout.attach(ownerId, initialPreference)`. The unique-owner handle exposes `update()`, `getSnapshot()`, `subscribe()`, and `dispose()`. A duplicate owner fails during attachment. Disposing the owner removes both slot projections, the 44px activity rail, and every reserved workspace dimension.

## Geometry and priority

- The Right workspace defaults to 480px, clamps to 360–840px, and cannot exceed 60% of the area to the right of the sidebar.
- The Bottom workspace defaults to 34% of the main-region height and clamps to 180px–65%.
- The collapsed activity rail is 44px; the conversation's minimum readable size is 420×320px.
- Automatic semantic groups in Right stack vertically at the default width; left/right edge splits are available only when both resulting Panes remain at least 280px wide.
- AppFrame owns pointer and keyboard resizing and commits the result through `WorkspaceLayoutHandle`.
- If docking would violate the conversation minimum, the active Pane becomes a Sheet over the main region only.
- Right Pane and Tool Details coexist when space permits. Otherwise, the last explicitly activated auxiliary surface wins while the other derives closed without losing its saved size or open preference.

## Mounting and compatibility

Pane maximization occupies only the DSH main region and does not use the browser Fullscreen API. The conversation, other Panes, and Tool Details remain mounted while hidden. `Escape` or the restore control clears the transient maximized state, and reload never restores that state.

An older DSH peer without the two workspace slots or `ctx.workspaceLayout` receives an explicit compatibility error. Production code does not fall back to `shell.overlay`, a fixed `280px` offset, or sidebar DOM discovery.

## Verification

- Geometry tests cover 1440, 1243, 1024, 768, and 390px widths, including dock, Sheet, Details priority, and maximization.
- AppFrame component coverage pins slot ownership, pointer and keyboard resizing, `Escape`, disposal, HMR-safe subscription, and the sidebar boundary invariant.
- Browser evidence covers Right and Bottom docking, keyboard cross-region movement, maximization and restore, Details priority, reload restoration, and the narrow Sheet projection.

## Alternatives considered

**Keep the full-page overlay.** Rejected because it hides the canonical sidebar, duplicates DSH page ownership, and makes workspace sizing invisible to AppFrame.

**Simulate docking with a fixed offset or sidebar selector.** Rejected because sidebar width is responsive and owner-private; an extension cannot safely infer the shell geometry.

**Adopt a third-party docking runtime.** Rejected because the product requires only Right and Bottom regions with bounded split depth, while AppFrame must still own sidebar, Details, and minimum conversation geometry.

**Use browser fullscreen or floating windows.** Rejected because maximization must preserve DSH navigation and the workspace is intentionally constrained to the area right of the sidebar.

## Consequences

- The DSH sidebar remains the single canonical owner of session navigation in every workspace state.
- Workspace bundles gain a stable layout contract and can share state across two independently mounted slot roots.
- AppFrame now carries the responsive geometry and auxiliary-surface arbitration logic.
- Bundles requiring this contract fail clearly on older DSH releases instead of degrading into a layout that covers navigation.
