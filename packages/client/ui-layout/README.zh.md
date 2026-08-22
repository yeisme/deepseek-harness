# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：四栏两行 AppFrame，加既有 `ctx.layout` 面板几何服务与 additive `ctx.workspaceLayout` 服务。它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`details`、`shell.workspace.right`、`shell.workspace.bottom` 与 `shell.overlay`。Sidebar 跨两行，Bottom 只位于 Conversation 下方，Right 与 Details 跨两行。侧边栏缩放边界仍是不可见命中条带，Details 与工作区 separator 提供可访问的缩放手柄。关闭的侧边栏保留控制轨道，已 attach 但关闭的工作区保留 44px 轨道，Details 则关闭到零宽度。

该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，并将主题的别名 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose 时会移除其自有的元数据节点，并一并清除其他全局写入。

AppFrame 在 dock 让步、Sheet 投影和 Pane 最大化期间始终保持 Conversation、两个 workspace occupant 与 Details 挂载；已连接 Session 通过 `SessionProvider` 渲染。`ctx.workspaceLayout.attach(ownerId, preference)` 同一时刻只允许一个 live owner，并返回 update/subscribe/dispose 句柄；owner dispose 后 44px 轨道与全部工作区预留立即消失。

Right 默认 480px（限制 360–840px，且不超过主区域 60%），Bottom 默认 34%（限制 180px–65%），Conversation 目标最低可读尺寸为 420×320px。若 dock 无法保住该下限，活动 Pane 投影为 Sheet，其左边界始终不越过真实 sidebar。Right 与 Details 采用最后一次显式打开优先级，空间恢复后按原偏好自动恢复。Pane 最大化只隐藏而不卸载其他表面，Escape 可恢复原布局。

`/client` 导出插件主体（`apply`／`inject`）、`LayoutController`、`WorkspaceLayoutController`、两个 layout service face、workspace preference/snapshot/handle 类型与 owner-share 接口。AppFrame 和面板 store 仍属于包内部；纯 workspace solver 可从其 `/src` 测试／开发路径使用。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值并关闭 Details；在不同 Session id 之间切换同样会关闭 Details，并忘记拖动后的宽度，而未选中表面会以零宽度渲染 Details，但不会修改几何偏好。
- **让步自动关闭是派生结果**：空间恢复后 Right 与 Details 会自行恢复；消费方不得把存储偏好当作实际渲染状态。
- **工作区持久化归 attach owner 所有**：`ctx.workspaceLayout` 自身是瞬时服务；Pane owner 只能持久化安全 canonical 展示状态，且不得恢复临时最大化。
- **同一时刻只能 attach 一个工作区 owner**：竞争的 docking runtime 会在加载阶段失败，而不是共享或替换当前 tracks。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
