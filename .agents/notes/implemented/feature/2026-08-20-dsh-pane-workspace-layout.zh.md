# Agent Note: DSH Pane 工作区进入正式布局

Status: implemented

[English](2026-08-20-dsh-pane-workspace-layout.md) | 中文

## 问题

扩展工作台此前通过 `shell.overlay` 挂载。它会覆盖 DSH canonical 会话侧边栏，并引入一套与会话、Tool Details、文件、终端和产物预览竞争的第二页面结构。工作区需要正式参与 AppFrame 布局，不依赖固定偏移、DOM selector 或全局 margin。

## 决策

`@deepseek-ai/dsh-client-ui-layout` 拥有两个 root-scoped single slot：

- `shell.workspace.right`
- `shell.workspace.bottom`

AppFrame 求解四列两行布局。DSH 会话侧边栏跨越两行，会话占据主列上行，Bottom 工作区只占主列下行，Right 工作区和 Tool Details 各自跨越两行。无论 dock、Sheet 还是最大化，工作区的左边界都不得越过实际侧边栏边缘。

扩展通过 `ctx.workspaceLayout.attach(ownerId, initialPreference)` 连接。唯一 owner 句柄提供 `update()`、`getSnapshot()`、`subscribe()` 和 `dispose()`；重复 owner 在 attach 时立即失败。owner dispose 后，两个 slot 投影、44px 活动轨道与所有工作区尺寸预留一并消失。

## 尺寸与优先级

- Right 工作区默认 480px，限制为 360–840px，且不超过侧边栏右侧可用区域的 60%。
- Bottom 工作区默认占主区域高度 34%，限制为 180px–65%。
- 收起活动轨道为 44px；会话最低可读尺寸为 420×320px。
- Right 内自动创建的语义 group 在默认宽度下纵向堆叠；只有拆分后两个 Pane 都能保持至少 280px 宽时，才允许左/右边缘 split。
- AppFrame 统一负责指针和键盘 resize，并通过 `WorkspaceLayoutHandle` 提交结果。
- 如果 dock 会破坏会话最小尺寸，活动 Pane 改为只覆盖主区域的 Sheet。
- 空间充足时 Right Pane 与 Tool Details 并存；否则最后一次明确激活的辅助表面优先，另一个只派生收起，不丢失已保存尺寸和打开偏好。

## 挂载与兼容性

Pane 最大化只占用 DSH 主区域，不调用浏览器 Fullscreen API。最大化期间，会话、其他 Pane 和 Tool Details 仅隐藏但不卸载。`Escape` 或恢复控件会清除临时最大化状态，重载也不会恢复该状态。

旧版 DSH 如果缺少两个 workspace slot 或 `ctx.workspaceLayout`，会收到明确兼容错误。生产代码不回退到 `shell.overlay`、固定 `280px` 偏移或 sidebar DOM 探测。

## 验证

- geometry 测试覆盖 1440、1243、1024、768 和 390px 宽度，包含 dock、Sheet、Details 优先级和最大化。
- AppFrame 组件覆盖固定 slot owner、指针与键盘 resize、`Escape`、dispose、HMR-safe 订阅和侧边栏边界不变式。
- 浏览器证据覆盖 Right/Bottom 停靠、键盘跨区域移动、最大化与恢复、Details 优先级、刷新恢复和窄屏 Sheet 投影。

## 考虑过的替代方案

**保留整页 overlay。** 拒绝，因为它会隐藏 canonical 侧边栏、重复 DSH 页面所有权，并让 AppFrame 无法感知工作区尺寸。

**用固定偏移或 sidebar selector 模拟停靠。** 拒绝，因为 sidebar 宽度是响应式且属于 owner 内部实现；扩展无法安全推断 shell geometry。

**引入第三方 docking runtime。** 拒绝，因为产品只需 Right 和 Bottom 区域与有界 split 深度，而 AppFrame 仍必须拥有 sidebar、Details 和会话最小几何尺寸。

**使用浏览器全屏或浮动窗口。** 拒绝，因为最大化必须保留 DSH 导航，工作区也明确限制在侧边栏右侧。

## 后果

- DSH 侧边栏在所有工作区状态下仍是会话导航的唯一 canonical owner。
- 工作区 bundle 获得稳定布局合同，并可在两个独立挂载的 slot root 间共享状态。
- AppFrame 现在承担响应式 geometry 与辅助表面仲裁逻辑。
- 依赖该合同的 bundle 在旧 DSH 上会明确失败，而不会退化为覆盖导航的布局。
