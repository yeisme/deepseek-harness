# @deepseek-ai/dsh-client-ui-plan

[English](README.md) | 中文

Plan mode 状态控件与计划文档 dock，纯浏览器 surface 插件。浏览器侧占用会话声明的 `conversation.input.plan` 单实例 seat（位于 access 模式控件右侧），并在 `conversation.input.dock` 列表注册可折叠的计划文档条；node 侧是空 apply（roster 行）。plan 行为本身——`/plan` 命令、边界或空闲即时提交的 `plan/mode` 状态、`plan` 投影单元与 policy 段——归 [`@deepseek-ai/dsh-plan-mode`](../../plan/plan-mode/README.zh.md) 所有，由 host roster 独立组合。

plan mode 经 `/plan` 命令路径进入：用户可以从 composer 的 `+` Command 菜单选择 Plan、输入 `/plan`，或点击本包渲染的未激活态 Plan 入口 chip。当 host 计算的 `plan` 投影有效目标为 plan mode 时（`pending ? !active : active`——折叠的 host 值而非客户端乐观态，帧到达即自动纠正），座位渲染 warn 色的 "Plan ×" 状态按钮，该按钮经 `command.execute` 执行 `/plan off`。当有效目标是稳定的默认模式时，座位渲染中性的 "Plan" 入口按钮，执行 `/plan`；待处理的退出会使座位保持为空，直到投影确认切换。未组合 plan-mode 的 host（或尚无会话的 Draft）不显示任何内容。plan mode 为有效目标期间，composer 文本框的 placeholder 切换为 plan 任务提示——"describe your task to generate plan"（中文「描述你的任务以生成计划」），经 ui-conversation 的 `conversation` locale 命名空间（`placeholder.plan` / `hint.plan` 键）本地化，并与已认领 `/plan` 命令的提示逐字共用同一份文案（由 composer 从同一投影渲染；owner 提供的 placeholder 优先）。

激活态 chip 携带无障碍描述 "Plan mode on, press to turn off"；入口 chip 携带 "Plan mode off, press to turn on"。准入失败（`matched: false`、业务错误、传输故障）以内联错误呈现，chip 保持显示直至投影确认切换。

模型通过稳定的 `exit_plan_mode` 工具退出 plan mode；其 plan 评审走已组合的 Web question 通道。

计划文档 dock 支持内联编辑：点击编辑按钮进入 Markdown 编辑器，保存时通过 `/plan-edit` 命令把新标题/正文持久化为新的 `plan/document` 修订；若当前计划已批准/执行/完成，旧文档会先标记为 `superseded`。当存在兼容的 Pane Workbench 服务时，dock 只提供一个“在工作区打开”入口；停靠、移动、最大化与关闭统一由 Pane 自身的 chrome 负责。本包不注册第二套会话侧边栏，也不会挂载覆盖整页的 fullscreen overlay。

上下文 Plan Pane 按执行扫描顺序组织信息，而不是先展示长文：计划状态、标题、轮次与模式 → 任务完成度和已本地化的任务状态 → 可选择方案 → 计划 Markdown → 关联目标 → 折叠的修订记录。方案选择在本地明确显示等待、失败和已选状态，持久化仍由 `/plan-select` 负责。若 Markdown 首个标题与计划标题相同，视图会去掉重复标题，避免 Pane 标签和内容区形成层层重复的 chrome。

## 模型体验

间接地，通过 chip 派发的 `/plan` 与 `/plan off` 命令行：`@deepseek-ai/dsh-plan-mode` 拥有这些命令行驱动的模型可见 policy 段、退出工具 schema 与已记录状态，本包只渲染投影并发送用户同样可以手敲的内容。

#### KV Cache 影响

进入或离开 plan mode 会改变活跃的 `plan:policy` 系统提示词段，因此改变请求前缀；chip 本身不添加任何提示词内容。

## 已知局限与延后工作

- **Plan mode 是引导而非执行沙箱**：需要强制只读规划的部署必须组合独立的沙箱与审批策略；当组合 `dsh-permission-presets` 时，可选的 `/plan-readonly` 桥接命令会一次切换两者。
- **chip 属于默认编辑器**：待处理的整编辑器交互（如 plan 评审）会临时取代 InputBar 及其 chip。
- **计划文档 dock 是紧凑条**：完整 markdown 仅在展开后显示；没有 `plan/document` 时 dock 隐藏。更完整的计划视图是可选上下文 Pane，未安装兼容 Pane provider 时不可用。最大化等布局命令归共享 workbench chrome 所有，不在 dock 中重复提供。
