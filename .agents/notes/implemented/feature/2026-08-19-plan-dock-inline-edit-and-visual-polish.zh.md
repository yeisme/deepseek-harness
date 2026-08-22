# Agent Note: Plan dock 与 Pane 工作区信息设计

Status: implemented

[English](2026-08-19-plan-dock-inline-edit-and-visual-polish.md) | 中文

## Problem

最初的计划文档 dock 只有紧凑状态行和可展开 Markdown。第一版上下文 Plan Pane 虽然解决了空间不足，但也带来了几个问题：共享 Pane 工具栏与标签下方又出现一层产品标题；长文档排在执行进度之前；任务直接显示 `IN_PROGRESS` 等机器枚举；方案选择没有等待、失败和已选反馈。

功能已经可用，但信息层级还不像 DSH 一贯安静、紧凑的工作区。

## Decision

- dock 保持为紧凑摘要与内联编辑 surface：展示语义化状态颜色、标题、编辑/保存/取消、展开/收起、修订记录，以及唯一一个“在工作区打开”入口。
- 停靠、移动、最大化与关闭统一由共享 Pane Workbench 负责。生产态 `PlanWorkspaceView` 不再渲染重复产品标题，不注册第二套 `conversation.sidebar`，也不挂载覆盖整页的 fullscreen overlay。
- Pane 按执行扫描顺序组织：
  1. 计划状态、标题、轮次与执行模式；
  2. 任务完成度与本地化任务状态；
  3. 可选择方案；
  4. 计划 Markdown；
  5. 关联目标；
  6. 默认折叠的修订记录。
- 卡片只用于方案，因为方案卡本身就是交互对象。任务、正文、目标和修订使用一条低边框的连续信息流。
- 方案选择立即显示等待、失败或已选状态。`/plan-select` 仍是持久化 owner；客户端状态只解释当前动作，并在新的方案集到达时自然失效。
- 当 Markdown 首个标题与持久化计划标题完全一致时，去掉重复标题。
- 使用 DSH 主题 token 表达状态语义、键盘焦点和 reduced-motion。待审使用 warning，已批准/执行中使用 business accent，已完成使用 success，已拒绝使用 error，已取代保持中性。
- 内联编辑通过 `/plan-edit <json>` 持久化。若当前计划已批准、执行中或已完成，会先把旧文档标记为 `superseded`，再追加新的 proposed 修订。

## Tests

- `packages/client/ui-plan/tests/plan-document-panel.client.spec.tsx` 覆盖单一工作区入口、内联编辑、保存成功、保存失败、状态、Markdown 与修订记录。
- `packages/client/ui-plan/tests/plan-workspace-view.client.spec.tsx` 覆盖重复标题移除、进度优先于正文、本地化任务状态、方案等待/成功/失败，以及修订折叠。
- `packages/client/ui-plan/tests/plan-pane-view.client.spec.ts` 覆盖 Pane provider 注册与打开请求，布局操作继续由 Pane chrome 负责。
- 聚焦验证：

  ```bash
  pnpm exec vitest run packages/client/ui-plan/tests/plan-document-panel.client.spec.tsx packages/client/ui-plan/tests/plan-workspace-view.client.spec.tsx packages/client/ui-plan/tests/plan-pane-view.client.spec.ts packages/client/ui-plan/tests/browser-plugin.client.spec.ts packages/client/ui-plan/tests/plan-mode-control.client.spec.tsx
  pnpm exec oxlint packages/client/ui-plan/src/client/PlanSidebar.tsx packages/client/ui-plan/src/client/PlanDocumentPanel.tsx packages/client/ui-plan/src/client/PlanPaneView.tsx packages/client/ui-plan/src/client/index.ts packages/client/ui-plan/src/client/locales.ts packages/client/ui-plan/tests/plan-workspace-view.client.spec.tsx packages/client/ui-plan/tests/plan-document-panel.client.spec.tsx packages/client/ui-plan/tests/browser-plugin.client.spec.ts
  pnpm run build:lib
  DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/plan-review.e2e.ts
  DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/shipped-composition.e2e.ts -t "assembles the shipped Web catalog"
  ```

## Alternatives considered

### 注册第二套会话侧边栏

不采用。它会复制工作区几何，并让 Plan、Files、Details、Terminal 与后续工具无法共用同一套 Pane 契约。

### 保留 Plan 自有 fullscreen overlay

生产态不采用。共享 Pane Workbench 已经负责最大化与恢复，第二套浮层会重复导航、焦点和响应式行为。

### 把概览、方案、任务和修订拆成标签页

首个交付不采用。Plan 主流程足够短，按顺序连续扫描更快；标签页反而会隐藏进度并增加切换成本。方案网格已经能在底部或更宽 Pane 中自适应增加列数。

### 把 Markdown 正文放在最前

不采用。执行期间，用户应先看到状态、进度、阻塞与待决方案，再阅读长计划正文。

## Consequences

- 用户无需先读完整计划，就能理解当前执行状态。
- Plan 控件不再与共享 Pane chrome 争夺注意力。
- 机器枚举不再泄漏到用户界面。
- dock 与 Pane 仍是投影消费者；计划、方案、任务与目标的持久状态继续由各自 host owner 管理。
- 已删除过时的 `PlanSidebar`、`PlanFullscreen` 与模块级视图 store；生产态只通过 Pane provider 挂载 `PlanWorkspaceView`。
- `SESSION_FORMAT_VERSION` 不变；本功能复用现有计划事件与命令。
